# InsightBoard - Level 1 (Submission)

## Completed Level
Level 1

## LLM API used
OpenAI - gpt-3.5-turbo (ChatCompletion API)

## Tech stack & infra
- Backend: FastAPI, Uvicorn, Python
- AI: OpenAI API (server-side)
- Frontend: Plain static HTML with Tailwind CSS + Chart.js
- Hosting recommendation: Render (backend), Vercel (frontend)

## What this project includes
- transcript submission (frontend textarea)
- AI powered action-item generation via OpenAI
- Task list with mark-as-complete and delete
- Pie chart showing completed vs pending tasks
- README and .env.example (no API keys committed)

## Run locally (fresh clone)
1. Backend
   - create virtual env and install
     ```
     python -m venv venv
     venv\Scripts\activate   # on Windows
     pip install -r backend/requirements.txt
     ```

   - set OpenAI key (Windows PowerShell example)
     ```
     $env:OPENAI_API_KEY="sk-...."
     ```

   - run server
     ```
     uvicorn backend.main:app --reload --port 8000
     ```

2. Frontend
   - open `frontend/index.html` in browser
   - or serve with a simple static server
   - edit `frontend/script.js` and replace `REPLACE_WITH_BACKEND_URL` with backend URL (for local use: http://127.0.0.1:8000)

## Hosted deployment (what you must provide)
- GitHub repo link (upload this project)
- Live hosted app link (deploy backend + frontend)
  - Backend: Deploy `backend/` to Render or Railway and set OPENAI_API_KEY in env.
  - Frontend: Deploy static `frontend/` to Vercel and set the API_BASE in `script.js` to the backend URL.

## Notes on evaluation criteria
- Code kept simple and readable for review.
- AI integration done server-side to keep API key safe.
- No secrets in repo.
- Focused on Level 1 per assignment.
