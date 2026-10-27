// js/99-main.js — Tabs, button wiring and the final boot() call (must load last)
/* ============================= TAB / NAV WIRING ============================= */

function renderActive(){
  switch(activeTab){
    case "dashboard": renderDashboard(); break;
    case "hallway": renderHallway(); break;
    case "analytics": renderAnalytics(); break;
    case "matrix": renderMatrix(); break;
    case "calendar": renderCalendar(); break;
    case "reserve": renderReserve(); break;
    case "temporary": renderTemporaryClients(); break;
    case "history": renderHistory(); break;
    case "viewers": renderViewerAccess(); break;
  }
}

function switchTab(tab){
  activeTab = tab;
  document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id==="view-"+tab));
  renderActive();
}

function wireStaticUI(){
  initializeAssistantWidget();

  document.querySelectorAll("nav.tabs button").forEach(b=>{
    b.addEventListener("click", ()=>switchTab(b.dataset.tab));
  });

  document.getElementById("addRoomBtn").addEventListener("click", ()=>openRoomModal(null));
  document.getElementById("addRoomBtn2").addEventListener("click", ()=>openRoomModal(null));
  document.getElementById("layoutLockBtn").addEventListener("click", ()=>{
    layoutLocked = !layoutLocked;
    renderHallway();
  });
  document.getElementById("addShapeBtn").addEventListener("click", ()=>openShapeModal(null));
  document.getElementById("editShapeBtn").addEventListener("click", ()=>{
    if (selectedShapeId) openShapeModal(selectedShapeId);
  });
  document.getElementById("closeShapeModal").addEventListener("click", closeShapeModal);
  document.getElementById("cancelShapeModal").addEventListener("click", closeShapeModal);
  document.getElementById("saveShapeBtn").addEventListener("click", saveShape);
  document.getElementById("deleteShapeBtn").addEventListener("click", deleteShape);
  document.getElementById("shapeModalBackdrop").addEventListener("click", e=>{ if (e.target.id==="shapeModalBackdrop") closeShapeModal(); });
  document.getElementById("importSeedBtn").addEventListener("click", importSeedData);
  if (!Array.isArray(window.SEED_ROOMS)) document.getElementById("importSeedBtn").style.display = "none";
  document.getElementById("closeExtendModal").addEventListener("click", closeExtendModal);
  document.getElementById("cancelExtendModal").addEventListener("click", closeExtendModal);
  document.getElementById("saveExtendBtn").addEventListener("click", saveExtend);
  document.getElementById("extendModalBackdrop").addEventListener("click", e=>{ if (e.target.id==="extendModalBackdrop") closeExtendModal(); });
  document.getElementById("closeRoomModal").addEventListener("click", closeRoomModal);
  document.getElementById("cancelRoomModal").addEventListener("click", closeRoomModal);
  document.getElementById("saveRoomBtn").addEventListener("click", saveRoom);
  document.getElementById("roomModalBackdrop").addEventListener("click", e=>{ if (e.target.id==="roomModalBackdrop") closeRoomModal(); });
  document.getElementById("closeTransferModal").addEventListener("click",closeTransferModal);
  document.getElementById("cancelTransferModal").addEventListener("click",closeTransferModal);
  document.getElementById("confirmTransferBtn").addEventListener("click",confirmBedTransfer);
  document.getElementById("transferModalBackdrop").addEventListener("click",e=>{if(e.target.id==="transferModalBackdrop")closeTransferModal();});

  ["filterGender","filterVacancy","filterDemographic"].forEach(id=>document.getElementById(id).addEventListener("change", renderDashboard));
  document.getElementById("filterSearch").addEventListener("input", renderDashboard);

  document.getElementById("calPrev").addEventListener("click", ()=>calNav(-1));
  document.getElementById("calNext").addEventListener("click", ()=>calNav(1));
  document.getElementById("calTodayBtn").addEventListener("click", calToday);

  document.getElementById("addProspectBtn").addEventListener("click", addProspect);
  ["pGender","pDemographic","pCheckIn"].forEach(id=>document.getElementById(id).addEventListener("input",refreshBedTargetSelectors));
  ["pGender","pDemographic"].forEach(id=>document.getElementById(id).addEventListener("change",refreshBedTargetSelectors));
  document.getElementById("tGender").addEventListener("change",refreshBedTargetSelectors);
  document.getElementById("addTemporaryBtn").addEventListener("click",addTemporaryClient);
}

boot();
