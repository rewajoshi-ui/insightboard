from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
import os, json, re, time, traceback, sys
from starlette.responses import FileResponse
from sqlmodel import select, Session, SQLModel, Field
from backend.db import create_db_and_tables, engine
from passlib.context import CryptContext
from jose import JWTError, jwt

try:
    import google.genai as genai
except Exception:
    try:
        from google import genai
    except Exception:
        try:
            import genai
        except Exception:
            genai = None

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# ✅ Accept either GOOGLE_API_KEY or GEMINI_API_KEY
API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
print("DEBUG: GOOGLE_API_KEY or GEMINI_API_KEY present? ->", "set" if API_KEY else "missing")

if genai and API_KEY:
    try:
        genai.configure(api_key=API_KEY)
    except Exception as e:
        print("DEBUG: genai.configure raised:", repr(e))

SECRET_KEY = os.getenv("JWT_SECRET", "devsecretkey")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True)
    name: Optional[str] = None
    hashed_password: str

class DBTask(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    text: str
    status: str = "pending"
    priority: Optional[str] = None
    created_at: Optional[float] = None

class TranscriptInput(BaseModel):
    transcript: str

class TaskOut(BaseModel):
    id: int
    text: str
    status: str
    priority: Optional[str] = None

class RegisterIn(BaseModel):
    email: str
    password: str
    name: Optional[str] = None

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: str

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = time.time() + ACCESS_TOKEN_EXPIRE_MINUTES * 60
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def decode_access_token(token: str):
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None

create_db_and_tables()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
if not os.path.isdir(static_dir):
    static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/", include_in_schema=False)
async def root():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"msg": "backend running"}

@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"detail": "Not Found"}

# ----------------- helper funcs -----------------
def chunk_text(text, max_chars=3000):
    parts = []
    start = 0
    n = len(text)
    while start < n:
        end = min(n, start + max_chars)
        seg = text[start:end]
        brk = seg.rfind("\n")
        if brk > int(max_chars*0.4):
            end = start + brk + 1
        else:
            brk2 = seg.rfind(". ")
            if brk2 > int(max_chars*0.4):
                end = start + brk2 + 1
        parts.append(text[start:end].strip())
        start = end
    return [p for p in parts if p]

def safe_parse_json_like(s):
    s = (s or "").strip()
    try:
        return json.loads(s)
    except:
        pass
    m = re.search(r'(\[.*\]|\{.*\})', s, flags=re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except:
            pass
    lines = []
    for ln in s.splitlines():
        ln = ln.strip()
        if not ln:
            continue
        ln = re.sub(r'^[\*\-\u2022\#\s]+', '', ln)
        lines.append(ln)
    return lines

def strip_speaker_prefix(text):
    text = text.strip()
    text = re.sub(r'^(?:\*\*|\*|\u2022)?\s*([A-Za-z ,\'\-\.\d]+)(?:\s*\([^\)]*\))?\s*:\s*', '', text)
    text = re.sub(r'^\s*[A-Z][a-z]+:\s*', '', text)
    return text.strip()

def extract_meta(text):
    meta = {"text": text.strip(), "assignee": None, "due": None, "priority": None}
    m = re.search(r'\(Due[:\s]+([^\)]+)\)', text, flags=re.I)
    if m:
        meta["due"] = m.group(1).strip()
        meta["text"] = re.sub(r'\(Due[:\s]+[^\)]+\)', '', meta["text"]).strip()
    m2 = re.search(r'\(When[:\s]+([^\)]+)\)', text, flags=re.I)
    if m2 and not meta["due"]:
        meta["due"] = m2.group(1).strip()
        meta["text"] = re.sub(r'\(When[:\s]+[^\)]+\)', '', meta["text"]).strip()
    m3 = re.search(r'^\s*([A-Z][a-z]+)\b', text)
    if m3:
        name = m3.group(1)
        if name and len(name) <= 20:
            meta["assignee"] = name.strip()
    meta["text"] = re.sub(r'^[\-\*\s\#\u2022]+', '', meta["text"]).strip()
    m4 = re.search(r'Priority[:\s]+(High|Medium|Low)', text, flags=re.I)
    if m4:
        meta["priority"] = m4.group(1).capitalize()
    return meta

def shorten_text(s, max_len=120):
    s = s.strip()
    if len(s) <= max_len:
        return s
    cut = s[:max_len]
    brk = cut.rfind('. ')
    if brk > int(max_len*0.4):
        return cut[:brk+1].strip()
    brk2 = cut.rfind(', ')
    if brk2 > int(max_len*0.4):
        return cut[:brk2+1].strip()
    return cut.strip() + "..."

def try_generate(client, model, prompt, max_retries=2):
    for attempt in range(max_retries):
        try:
            resp = client.models.generate_content(model=model, contents=prompt)
            text = None
            if hasattr(resp, "text") and resp.text:
                text = resp.text
            if not text and hasattr(resp, "candidates") and resp.candidates:
                cand = resp.candidates[0]
                text = getattr(cand, "content", None) or (cand.get("content") if isinstance(cand, dict) else None)
            if not text:
                text = str(resp)
            return text
        except Exception:
            time.sleep(0.5)
            continue
    raise Exception("model call failed")

# ----------------- auth helpers -----------------
def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="authorization header missing")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="invalid auth header")
    token = parts[1]
    data = decode_access_token(token)
    if not data or "sub" not in data:
        raise HTTPException(status_code=401, detail="invalid token")
    email = data["sub"]
    with Session(engine) as session:
        stmt = select(User).where(User.email == email)
        user = session.exec(stmt).first()
        if not user:
            raise HTTPException(status_code=401, detail="user not found")
        return user

# ----------------- auth routes -----------------
@app.post("/register", response_model=TokenOut)
def register(data: RegisterIn):
    with Session(engine) as session:
        stmt = select(User).where(User.email == data.email)
        existing = session.exec(stmt).first()
        if existing:
            raise HTTPException(status_code=400, detail="email exists")
        user = User(email=data.email, name=data.name or "", hashed_password=get_password_hash(data.password))
        session.add(user)
        session.commit()
        session.refresh(user)
        token = create_access_token({"sub": user.email})
        return {"access_token": token, "user": user.name or user.email}

@app.post("/login", response_model=TokenOut)
def login(data: RegisterIn):
    with Session(engine) as session:
        stmt = select(User).where(User.email == data.email)
        user = session.exec(stmt).first()
        if not user or not verify_password(data.password, user.hashed_password):
            raise HTTPException(status_code=401, detail="invalid credentials")
        token = create_access_token({"sub": user.email})
        return {"access_token": token, "user": user.name or user.email}

# ----------------- task generation -----------------
@app.post("/generate-tasks", response_model=List[TaskOut])
def generate_tasks(data: TranscriptInput, user: User = Depends(get_current_user)):
    if os.getenv("GEMINI_MOCK", "").lower() in ("1", "true", "yes"):
        mock = [
            {"text": "Follow up on payment bug", "priority": "High"},
            {"text": "Schedule investigation meeting", "priority": "Medium"}
        ]
        cleaned = []
        with Session(engine) as session:
            for item in mock:
                dbt = DBTask(user_id=user.id, text=item["text"], status="pending", priority=item.get("priority"), created_at=time.time())
                session.add(dbt)
                session.commit()
                session.refresh(dbt)
                cleaned.append(TaskOut(id=dbt.id, text=dbt.text, status=dbt.status, priority=dbt.priority))
        return cleaned

    try:
        if not genai:
            raise HTTPException(status_code=500, detail="genai sdk missing on server")

        # ✅ use GOOGLE_API_KEY or GEMINI_API_KEY
        api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="Google/Gemini API key not set on server")

        client = genai.Client(api_key=api_key)

        candidate_models = [
            "models/gemini-2.5-flash",
            "models/gemini-1.5-flash-latest",
            "models/gemini-2.5-pro-preview-06-05"
        ]
        transcript = (data.transcript or "").strip()
        if not transcript:
            return []

        system_instructions = (
            "You are a strict JSON generator. Given a transcript chunk, return ONLY a JSON array of objects."
            " Each object must have keys: text, assignee, due, priority."
        )

        chunks = chunk_text(transcript, max_chars=3000)
        aggregated = []
        last_exc = None

        for model in candidate_models:
            try:
                for chunk in chunks:
                    prompt = system_instructions + "\n\nTranscript chunk:\n" + chunk + "\n\nReturn JSON array of tasks."
                    text = try_generate(client, model, prompt)
                    parsed = safe_parse_json_like(text)
                    if isinstance(parsed, dict):
                        parsed = [parsed]
                    if not isinstance(parsed, list):
                        parsed = safe_parse_json_like(str(parsed))
                    for item in parsed or []:
                        if isinstance(item, str):
                            raw = strip_speaker_prefix(item)
                            meta = extract_meta(raw)
                        elif isinstance(item, dict):
                            txt = item.get("text") or item.get("task") or item.get("title") or ""
                            txt = strip_speaker_prefix(str(txt))
                            meta = extract_meta(txt)
                            if item.get("assignee"):
                                meta["assignee"] = item.get("assignee")
                            if item.get("due"):
                                meta["due"] = item.get("due")
                            if item.get("priority"):
                                p = str(item.get("priority")).capitalize()
                                if p in ("High","Medium","Low"):
                                    meta["priority"] = p
                        else:
                            continue
                        meta["text"] = shorten_text(meta["text"])
                        if not meta.get("priority"):
                            meta["priority"] = "Medium"
                        if meta["text"]:
                            aggregated.append(meta)
                if aggregated:
                    break
            except Exception as e:
                last_exc = e
                continue

        if not aggregated:
            raise HTTPException(status_code=500, detail="no candidate model worked")

        cleaned = []
        seen = set()
        with Session(engine) as session:
            for item in aggregated:
                key = item["text"].lower()
                if key in seen:
                    continue
                seen.add(key)
                dbt = DBTask(user_id=user.id, text=item["text"], status="pending", priority=item.get("priority"), created_at=time.time())
                session.add(dbt)
                session.commit()
                session.refresh(dbt)
                cleaned.append(TaskOut(id=dbt.id, text=dbt.text, status=dbt.status, priority=dbt.priority))

        return cleaned

    except HTTPException:
        raise
    except Exception as e:
        tb = traceback.format_exc()
        print("ERROR in generate_tasks:", str(e), file=sys.stderr)
        print(tb, file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"server exception: {str(e)}")

# ----------------- task CRUD -----------------
@app.get("/tasks", response_model=List[TaskOut])
def list_tasks(user: User = Depends(get_current_user)):
    with Session(engine) as session:
        stmt = select(DBTask).where(DBTask.user_id == user.id)
        rows = session.exec(stmt).all()
        return [TaskOut(id=r.id, text=r.text, status=r.status, priority=r.priority) for r in rows]

@app.post("/tasks/{task_id}/complete")
def complete_task(task_id: int, user: User = Depends(get_current_user)):
    with Session(engine) as session:
        stmt = select(DBTask).where(DBTask.id == task_id, DBTask.user_id == user.id)
        t = session.exec(stmt).first()
        if not t:
            raise HTTPException(status_code=404, detail="not found")
        t.status = "completed"
        session.add(t)
        session.commit()
        return {"msg": "done"}

@app.delete("/tasks/{task_id}")
def delete_task(task_id: int, user: User = Depends(get_current_user)):
    with Session(engine) as session:
        stmt = select(DBTask).where(DBTask.id == task_id, DBTask.user_id == user.id)
        t = session.exec(stmt).first()
        if t:
            session.delete(t)
            session.commit()
    return {"msg": "deleted"}


