// js/03-clock-and-sync.js — Live clock and Firestore listeners (per-user collections)
/* ---------------------------- live clock ---------------------------- */

function startClock(){
  const tick = ()=>{
    const now = new Date();
    const timeEl = document.getElementById("clockTime");
    const dateEl = document.getElementById("clockDate");
    if (timeEl) timeEl.textContent = now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    if (dateEl) dateEl.textContent = now.toLocaleDateString([], {weekday:'short', year:'numeric', month:'short', day:'numeric'});
  };
  tick();
  setInterval(tick, 1000);
  // Re-render time-sensitive views once a minute so statuses/countdowns stay fresh
  setInterval(()=>{
    if (activeTab) renderActive();
    processDueReservations().catch(err=>console.error("Reservation check-in processing failed",err));
  }, 60000);
}

/* ---------------------------- firestore sync ---------------------------- */

function subscribeData(){
  if (unsubRooms) unsubRooms();
  if (unsubShapes) unsubShapes();
  if (unsubProspects) unsubProspects();
  if (unsubTemporaryClients) unsubTemporaryClients();
  if (unsubHistory) unsubHistory();
  assistantDataLoaded = {rooms:false,shapes:false,prospects:false,temporaryClients:false};
  unsubRooms = userCollection("rooms").orderBy("room").onSnapshot(snap=>{
    rooms = snap.docs.map(d=>({id:d.id, ...d.data()}));
    assistantDataLoaded.rooms = true;
    renderActive();
    scheduleVacancySync();
    processDueReservations().catch(err=>console.error("Reservation check-in processing failed",err));
  }, err=>console.error(err));

  unsubShapes = userCollection("shapes").onSnapshot(snap=>{
    shapes = snap.docs.map(d=>({id:d.id, ...d.data()}));
    assistantDataLoaded.shapes = true;
    renderActive();
  }, err=>console.error(err));

  unsubProspects = userCollection("prospects").orderBy("checkIn").onSnapshot(snap=>{
    prospects = snap.docs.map(d=>({id:d.id, ...d.data()}));
    assistantDataLoaded.prospects = true;
    renderActive();
    processDueReservations().catch(err=>console.error("Reservation check-in processing failed",err));
  }, err=>console.error(err));

  unsubTemporaryClients = userCollection("temporary_dorm_clients").orderBy("createdAt", "desc").onSnapshot(snap=>{
    temporaryClients = snap.docs.map(d=>({id:d.id, ...d.data()}));
    assistantDataLoaded.temporaryClients = true;
    renderActive();
  }, err=>console.error(err));

  unsubHistory = userCollection("tenant_history").orderBy("leftAt","desc").limit(300).onSnapshot(snap=>{
    tenantHistory = snap.docs.map(d=>({id:d.id, ...d.data()}));
    renderActive();
    purgeExpiredHistory().catch(err=>console.error("History cleanup failed",err));
  }, err=>console.error(err));

  startViewerAccess();
}

function userCollection(name){
  if (!currentUser || !currentUser.uid) throw new Error("A signed-in user is required to access data.");
  return db.collection("users").doc(currentUser.uid).collection(name);
}

async function importSeedData(){
  if (!Array.isArray(window.SEED_ROOMS)){
    alert("The sample-room import is only available when you run the app from your own computer.");
    return;
  }
  if (rooms.length){
    if (!confirm("You already have " + rooms.length + " rooms saved. Import the sample data anyway (it will add alongside, skipping room numbers that already exist)?")) return;
  }
  const existingNumbers = new Set(rooms.map(r=>r.room));
  const batch = db.batch();
  let added = 0;
  window.SEED_ROOMS.forEach((r, i)=>{
    if (existingNumbers.has(r.room)) return;
    const ref = userCollection("rooms").doc();
    batch.set(ref, {
      room: r.room,
      type: "Room",
      demographic: "Mixed",
      tenancyMode: "Bedspace",
      capacity: r.capacity,
      gender: r.gender,
      x: 20 + (i % 6) * 150,
      y: 20 + Math.floor(i / 6) * 130,
      beds: r.beds.map(b=>({slot:b.slot, tenant:b.tenant, start:b.start, end:b.end, reservedFor:null, residentType:"Student", residentGender:"Unspecified"}))
    });
    added++;
  });
  await batch.commit();
  alert("Imported " + added + " rooms.");
}

