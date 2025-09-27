const API_BASE = "http://127.0.0.1:8001";
const getToken = ()=>localStorage.getItem("access_token");
const setToken = (t)=>{ if(t) localStorage.setItem("access_token",t); else localStorage.removeItem("access_token"); };
const authModal = document.getElementById("auth-modal");
const modalTitle = document.getElementById("modal-title");
const authError = document.getElementById("auth-error");
const nameInput = document.getElementById("name-input");
const emailInput = document.getElementById("email-input");
const passwordInput = document.getElementById("password-input");
const authSubmit = document.getElementById("auth-submit");
const authCancel = document.getElementById("auth-cancel");
const showLogin = document.getElementById("show-login");
const showRegister = document.getElementById("show-register");
const logoutBtn = document.getElementById("logout-btn");
const generateBtn = document.getElementById("generate-btn");
const transcriptEl = document.getElementById("transcript");
const tasksList = document.getElementById("tasks-list");
const noteEl = document.getElementById("note");
let chart=null;

function updateAuthUI(){
  const t = getToken();
  if(t){
    showLogin.style.display="none";
    showRegister.style.display="none";
    logoutBtn.classList.remove("hidden");
    noteEl.style.display="none";
  } else {
    showLogin.style.display="";
    showRegister.style.display="";
    logoutBtn.classList.add("hidden");
    noteEl.style.display="";
  }
}

function openModal(mode){
  authError.classList.add("hidden");
  if(mode==="login"){
    modalTitle.textContent="Log in";
    nameInput.style.display="none";
  } else {
    modalTitle.textContent="Register";
    nameInput.style.display="";
  }
  authModal.classList.remove("hidden");
  authModal.style.display="flex";
}

function closeModal(){
  authModal.classList.add("hidden");
  authModal.style.display="none";
}

showLogin.addEventListener("click",()=>openModal("login"));
showRegister.addEventListener("click",()=>openModal("register"));
authCancel.addEventListener("click",()=>closeModal());

logoutBtn.addEventListener("click",()=>{
  setToken(null);
  updateAuthUI();
  tasksList.innerHTML="";
  renderChart(0,0);
});

authSubmit.addEventListener("click", async ()=>{
  const mode = modalTitle.textContent.toLowerCase().includes("register") ? "register" : "login";
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const name = nameInput.value.trim();
  authError.classList.add("hidden");
  if(!email || !password){ authError.textContent="Enter email and password"; authError.classList.remove("hidden"); return; }
  const payload = mode==="register" ? {email,password,name} : {email,password};
  try{
    const res = await fetch(`${API_BASE}/${mode}`, {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if(!res.ok){ authError.textContent = (data.detail && typeof data.detail === "string") ? data.detail : JSON.stringify(data); authError.classList.remove("hidden"); return; }
    setToken(data.access_token);
    closeModal();
    updateAuthUI();
    await fetchAndRenderTasks();
  }catch(e){
    authError.textContent="Network error"; authError.classList.remove("hidden");
  }
});

async function fetchAndRenderTasks(){
  tasksList.innerHTML="";
  const token = getToken();
  if(!token) return;
  try{
    const res = await fetch(`${API_BASE}/tasks`, {headers: {Authorization: "Bearer "+token}});
    if(res.status===401){ setToken(null); updateAuthUI(); return; }
    const data = await res.json();
    let completed=0, pending=0;
    if(Array.isArray(data)){
      for(const t of data){
        const li = document.createElement("li");
        li.className="p-3 bg-white border rounded flex justify-between items-center";
        li.innerHTML = `<div><div class="font-medium">${escapeHtml(t.text)}</div><div class="text-xs text-gray-500">${escapeHtml(t.status)}</div></div>
        <div class="flex gap-2">
          <button data-id="${t.id}" data-action="complete" class="px-2 py-1 bg-green-600 text-white rounded text-sm">Complete</button>
          <button data-id="${t.id}" data-action="delete" class="px-2 py-1 bg-red-600 text-white rounded text-sm">Delete</button>
        </div>`;
        tasksList.appendChild(li);
        if(t.status==="completed") completed++; else pending++;
      }
    }
    renderChart(completed,pending);
  }catch(e){}
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }

document.addEventListener("click", async (e)=>{
  const btn = e.target.closest("button[data-id]");
  if(!btn) return;
  const id = btn.getAttribute("data-id");
  const action = btn.getAttribute("data-action");
  const token = getToken();
  if(!token) return;
  if(action==="complete"){
    await fetch(`${API_BASE}/tasks/${id}/complete`, {method:"POST", headers:{Authorization:"Bearer "+token}});
  } else {
    await fetch(`${API_BASE}/tasks/${id}`, {method:"DELETE", headers:{Authorization:"Bearer "+token}});
  }
  await fetchAndRenderTasks();
});

generateBtn.addEventListener("click", async ()=>{
  const token = getToken();
  if(!token){ openModal("login"); return; }
  const text = transcriptEl.value.trim();
  if(!text) return;
  generateBtn.disabled=true;
  generateBtn.textContent="Generating..."
  try{
    const res = await fetch(`${API_BASE}/generate-tasks`, {
      method:"POST",
      headers: {"Content-Type":"application/json", Authorization:"Bearer "+token},
      body: JSON.stringify({transcript:text})
    });
    const data = await res.json();
    if(!res.ok){ alert("Server error: "+JSON.stringify(data)); return; }
    transcriptEl.value="";
    await fetchAndRenderTasks();
  }catch(e){ alert("Network error"); }
  finally{ generateBtn.disabled=false; generateBtn.textContent="Generate Tasks"; }
});

function renderChart(completed,pending){
  const ctx = document.getElementById("pieChart").getContext("2d");
  if(chart) chart.destroy();
  chart = new Chart(ctx, {
    type:"pie",
    data:{
      labels:["Completed","Pending"],
      datasets:[{data:[completed,pending], backgroundColor: ["#10B981","#F97316"]}]
    },
    options:{responsive:true,plugins:{legend:{position:"bottom"}}}
  });
  document.getElementById("progress-text").textContent = `${completed} completed • ${pending} pending`;
}

updateAuthUI();
fetchAndRenderTasks();

