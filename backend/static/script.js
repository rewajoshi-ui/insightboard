// static/script.js
// Robust modal + auth wiring for index.html markup
// - Uses Tailwind's "hidden" via classList rather than style hacks
// - Defensive guards against double-binding
// - Esc to close, backdrop click, data-close on Cancel
// - Keeps your existing API calls and event delegation intact

window.API_BASE = window.API_BASE || (function(){
  try{
    const o = window.location && window.location.origin;
    if(o && !o.startsWith('file:')) return o;
  }catch(e){}
  return 'http://127.0.0.1:8000';
})();

const getToken = () => localStorage.getItem("access_token");
const setToken = (t) => { if (t) localStorage.setItem("access_token", t); else localStorage.removeItem("access_token"); };

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }

(function(){
  function safe(q){ try{ return document.querySelector(q); }catch(e){ return null; } }

  // cached nodes
  const authModal = safe("#auth-modal");
  const modalTitle = safe("#modal-title");
  const authError = safe("#auth-error");
  const nameInput = safe("#name-input");
  const emailInput = safe("#email-input");
  const passwordInput = safe("#password-input");
  const authSubmit = safe("#auth-submit");
  const authCancel = safe("[data-close]") || safe("#auth-cancel");
  const showLogin = safe("#show-login");
  const showRegister = safe("#show-register");
  const logoutBtn = safe("#logout-btn");
  const generateBtn = safe("#generate-btn");
  const transcriptEl = safe("#transcript");
  const tasksList = safe("#tasks-list");
  const noteEl = safe("#note");

  if(!authModal){
    console.warn('Auth modal not found: #auth-modal — script will still wire other handlers.');
  }

  // avoid double bind if script reloaded
  if(window.__insight_auth_bound) return;
  window.__insight_auth_bound = true;

  function updateAuthUI(){
    const t = getToken();
    if(t){
      if (showLogin) showLogin.classList.add("hidden");
      if (showRegister) showRegister.classList.add("hidden");
      if (logoutBtn) logoutBtn.classList.remove("hidden");
      if (noteEl) noteEl.classList.add("hidden");
    } else {
      if (showLogin) showLogin.classList.remove("hidden");
      if (showRegister) showRegister.classList.remove("hidden");
      if (logoutBtn) logoutBtn.classList.add("hidden");
      if (noteEl) noteEl.classList.remove("hidden");
    }
  }

  function openModal(mode){
    if (authError) authError.classList.add("hidden");
    if(!modalTitle) return;
    if(mode === "login"){
      modalTitle.textContent = "Log in";
      if(nameInput) nameInput.classList.add("hidden");
    } else {
      modalTitle.textContent = "Register";
      if(nameInput) nameInput.classList.remove("hidden");
    }
    if(authModal){
      authModal.classList.remove("hidden");
      authModal.style.display = 'flex';
      const focusable = authModal.querySelector('input, button, [tabindex]:not([tabindex="-1"])');
      if(focusable) try{ focusable.focus(); }catch(e){}
      document.documentElement.style.overflow = 'hidden';
    }
  }

  function closeModal(){
    if(authModal){
      authModal.classList.add("hidden");
      authModal.style.display = 'none';
      document.documentElement.style.overflow = '';
      if(authError){ authError.classList.add('hidden'); authError.textContent = ''; }
    }
  }

  // wire openers (login/register)
  if(showLogin && !showLogin.__insight_bound){
    showLogin.addEventListener('click', (e) => { e.preventDefault(); openModal('login'); });
    showLogin.__insight_bound = true;
  }

  if(showRegister && !showRegister.__insight_bound){
    showRegister.addEventListener('click', (e) => { e.preventDefault(); openModal('register'); });
    showRegister.__insight_bound = true;
  }

  // data-close (cancel)
  if(authCancel && !authCancel.__insight_close_bound){
    authCancel.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });
    authCancel.__insight_close_bound = true;
  }

  // backdrop click: assume authModal is the backdrop
  if(authModal && !authModal.__insight_backdrop_bound){
    authModal.addEventListener('click', (e) => {
      if(e.target === authModal) closeModal();
    });
    authModal.__insight_backdrop_bound = true;
  }

  // Esc to close
  if(!window.__insight_esc_bound){
    document.addEventListener('keydown', (e) => {
      const shown = authModal && getComputedStyle(authModal).display !== 'none';
      if((e.key === 'Escape' || e.key === 'Esc') && shown) closeModal();
    });
    window.__insight_esc_bound = true;
  }

  // submit logic (unchanged semantics, just defensive)
  if(authSubmit && !authSubmit.__insight_submit_bound){
    authSubmit.addEventListener('click', async (ev) => {
      ev && ev.preventDefault && ev.preventDefault();
      const mode = modalTitle && modalTitle.textContent && modalTitle.textContent.toLowerCase().includes("register") ? "register" : "login";
      const email = emailInput ? emailInput.value.trim() : "";
      const password = passwordInput ? passwordInput.value : "";
      const name = nameInput ? nameInput.value.trim() : "";
      if(authError) authError.classList.add("hidden");
      if(!email || !password){ if(authError){ authError.textContent="Enter email and password"; authError.classList.remove("hidden"); } return; }
      const payload = mode === "register" ? {email,password,name} : {email,password};
      try{
        const res = await fetch(`${window.API_BASE}/${mode}`, {
          method:"POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(()=>({}));
        if(!res.ok){ if(authError){ authError.textContent = (data.detail && typeof data.detail === "string") ? data.detail : JSON.stringify(data); authError.classList.remove("hidden"); } return; }
        setToken(data.access_token);
        closeModal();
        updateAuthUI();
        await fetchAndRenderTasks();
      }catch(e){
        if(authError){ authError.textContent="Network error"; authError.classList.remove("hidden"); }
      }
    });
    authSubmit.__insight_submit_bound = true;
  }

  // logout
  if(logoutBtn && !logoutBtn.__insight_bound){
    logoutBtn.addEventListener("click", ()=>{ setToken(null); updateAuthUI(); if(tasksList) tasksList.innerHTML=""; try{ renderChart(0,0); }catch{} });
    logoutBtn.__insight_bound = true;
  }

  // generate button
  if(generateBtn && !generateBtn.__insight_bound){
    generateBtn.addEventListener("click", async ()=> {
      const token = getToken();
      if(!token){ openModal("login"); return; }
      const text = transcriptEl ? transcriptEl.value.trim() : "";
      if(!text) return;
      generateBtn.disabled = true;
      const origText = generateBtn.textContent;
      generateBtn.textContent = "Generating...";
      try{
        const res = await fetch(`${window.API_BASE}/generate-tasks`, {
          method:"POST",
          headers: {"Content-Type":"application/json", Authorization:"Bearer "+token},
          body: JSON.stringify({transcript:text})
        });
        const data = await res.json().catch(()=>({}));
        if(!res.ok){ alert("Server error: "+JSON.stringify(data)); return; }
        if(transcriptEl) transcriptEl.value = "";
        await fetchAndRenderTasks();
      }catch(e){ alert("Network error"); }
      finally{ generateBtn.disabled=false; generateBtn.textContent = origText || "Generate Tasks"; }
    });
    generateBtn.__insight_bound = true;
  }

  // tasks fetch/render
  async function fetchAndRenderTasks(){
    if(!tasksList) return;
    tasksList.innerHTML = "";
    const token = getToken();
    if(!token) return;
    try{
      const res = await fetch(`${window.API_BASE}/tasks`, {headers: {Authorization: "Bearer "+token}});
      if(res.status === 401){ setToken(null); updateAuthUI(); return; }
      const data = await res.json().catch(()=>[]);
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
      try{ renderChart(completed,pending); }catch(e){}
    }catch(e){}
  }

  // click events forwarded by the app-level delegation
  document.addEventListener("app:button-click", async (ev)=>{
    const { action, button } = ev.detail || {};
    if(!action) return;
    if(action === "show-login" && typeof window.showLogin === 'function') return window.showLogin(button);
    if(action === "generate" && typeof window.handleGenerate === 'function') return window.handleGenerate(button);
    if(action === "complete" || action === "delete"){
      const id = button.getAttribute("data-id");
      const token = getToken();
      if(!token) return;
      try{
        if(action === "complete") await fetch(`${window.API_BASE}/tasks/${id}/complete`, {method:"POST", headers:{Authorization:"Bearer "+token}});
        else await fetch(`${window.API_BASE}/tasks/${id}`, {method:"DELETE", headers:{Authorization:"Bearer "+token}});
      if (typeof window.fetchAndRenderTasks === 'function') {
  await window.fetchAndRenderTasks();
}
      }catch(e){}
    }
  });

  function renderChart(completed,pending){
    try{
      const ctxEl = document.getElementById("pieChart");
      if(!ctxEl) return;
      const ctx = ctxEl.getContext("2d");
      if(window.chart) window.chart.destroy();
      window.chart = new Chart(ctx, {
        type:"pie",
        data:{
          labels:["Completed","Pending"],
          datasets:[{data:[completed,pending], backgroundColor: ["#10B981","#F97316"]}]
        },
        options:{responsive:true,plugins:{legend:{position:"bottom"}}}
      });
      const prog = document.getElementById("progress-text");
      if(prog) prog.textContent = `${completed} completed • ${pending} pending`;
    }catch(e){}
  }

  // initial UI
  updateAuthUI();
  fetchAndRenderTasks();

  // expose fetchAndRenderTasks so delegated handlers can use it
window.fetchAndRenderTasks = fetchAndRenderTasks;

})();
