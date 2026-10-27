/* =========================================================================
   VIEWER ACCESS (admin side)
   The admin picks a dorm code + password. Viewers sign in with Google on
   viewer.html, enter them, and then see ONLY a name-free vacancy list that
   this file keeps up to date in  dorms/{code}/vacancy.
   Firestore layout:
     users/{adminUid}/settings/viewerAccess   -> {code, dormName, enabled}
     dorms/{code}                             -> {ownerUid, dormName, enabled}
     dormSecrets/{code}                       -> {ownerUid, passwordHash}   (owner only)
     dorms/{code}/vacancy/{roomId}            -> room, gender, total, vacant, status
     dorms/{code}/viewers/{viewerUid}         -> people who joined
     dorms/{code}/blocked/{viewerUid}         -> people the admin removed
   ========================================================================= */

let viewerAccess = null;            // {code, dormName, enabled} or null
let viewerAccessLoaded = false;
let viewerList = [];
let blockedList = [];
let unsubViewerSettings = null, unsubViewerList = null, unsubBlockedList = null;
let vacancySyncTimer = null;
let vacancySyncedCode = null;
let vacancyPushed = new Map();      // roomId -> JSON last written
let vacancySyncRunning = false;
let vacancySyncAgain = false;

function dormRef(code){ return db.collection("dorms").doc(code); }
function viewerPageUrl(){ return new URL("viewer.html", location.href).href; }
function serverTime(){ return firebase.firestore.FieldValue.serverTimestamp(); }

/* ---------------------------- lifecycle ---------------------------- */

function startViewerAccess(){
  stopViewerAccess();
  unsubViewerSettings = userCollection("settings").doc("viewerAccess").onSnapshot(snap=>{
    const previousCode = viewerAccess ? viewerAccess.code : null;
    viewerAccess = snap.exists && snap.data().code ? snap.data() : null;
    viewerAccessLoaded = true;
    if ((viewerAccess ? viewerAccess.code : null) !== previousCode) attachViewerLists();
    renderViewerAccess();
    scheduleVacancySync(true);
  }, err=>console.error("Viewer access settings failed", err));
}

function stopViewerAccess(){
  if (unsubViewerSettings) unsubViewerSettings();
  unsubViewerSettings = null;
  detachViewerLists();
  clearTimeout(vacancySyncTimer);
  viewerAccess = null;
  viewerAccessLoaded = false;
  viewerList = [];
  blockedList = [];
  vacancySyncedCode = null;
  vacancyPushed = new Map();
  const host = document.getElementById("viewerAccessPanel");
  if (host){ host.dataset.mode = ""; host.innerHTML = ""; }
}

function detachViewerLists(){
  if (unsubViewerList) unsubViewerList();
  if (unsubBlockedList) unsubBlockedList();
  unsubViewerList = null;
  unsubBlockedList = null;
}

function attachViewerLists(){
  detachViewerLists();
  viewerList = [];
  blockedList = [];
  if (!viewerAccess || !viewerAccess.code) return;
  const dorm = dormRef(viewerAccess.code);
  unsubViewerList = dorm.collection("viewers").orderBy("joinedAt","desc").onSnapshot(snap=>{
    viewerList = snap.docs.map(d=>({id:d.id, ...d.data()}));
    renderViewerAccess();
  }, err=>console.error("Viewer list failed", err));
  unsubBlockedList = dorm.collection("blocked").onSnapshot(snap=>{
    blockedList = snap.docs.map(d=>({id:d.id, ...d.data()}));
    renderViewerAccess();
  }, err=>console.error("Removed-viewer list failed", err));
}

/* ---------------------------- name-free vacancy copy ---------------------------- */

function scheduleVacancySync(immediate){
  clearTimeout(vacancySyncTimer);
  vacancySyncTimer = setTimeout(()=>{
    syncViewerVacancy().catch(err=>console.error("Vacancy sync failed", err));
  }, immediate ? 200 : 1500);
}

async function syncViewerVacancy(){
  if (vacancySyncRunning){ vacancySyncAgain = true; return; }
  if (!db || !currentUser || !viewerAccess || !viewerAccess.code || !assistantDataLoaded.rooms) return;
  vacancySyncRunning = true;
  try{
    const code = viewerAccess.code;
    const col = dormRef(code).collection("vacancy");
    if (vacancySyncedCode !== code){
      // First sync for this code: remember what is already there so removed rooms get cleaned up.
      const existing = await col.get();
      vacancyPushed = new Map();
      existing.docs.forEach(d=>vacancyPushed.set(d.id, "__existing__"));
      vacancySyncedCode = code;
    }
    const next = new Map();
    rooms.forEach(room=>{
      const v = roomVacancy(room);
      next.set(room.id, {
        room: room.room || "",
        gender: room.gender || "Mixed",
        demographic: room.demographic || "Mixed",
        total: v.total,
        vacant: v.vacant,
        status: v.vacant > 0 ? "vacant" : "full"
      });
    });
    const ops = [];
    next.forEach((data,id)=>{
      const key = JSON.stringify(data);
      if (vacancyPushed.get(id) !== key) ops.push({id, data, key});
    });
    const removals = [];
    vacancyPushed.forEach((_,id)=>{ if (!next.has(id)) removals.push(id); });
    const all = [...ops.map(o=>({type:"set",...o})), ...removals.map(id=>({type:"delete",id}))];
    for (let i=0; i<all.length; i+=100){
      const chunk = all.slice(i, i+100);
      const batch = db.batch();
      chunk.forEach(op=>{
        if (op.type === "set") batch.set(col.doc(op.id), {...op.data, updatedAt: serverTime()});
        else batch.delete(col.doc(op.id));
      });
      await batch.commit();
      chunk.forEach(op=>{
        if (op.type === "set") vacancyPushed.set(op.id, op.key);
        else vacancyPushed.delete(op.id);
      });
    }
  } finally {
    vacancySyncRunning = false;
    if (vacancySyncAgain){ vacancySyncAgain = false; scheduleVacancySync(); }
  }
}

/* ---------------------------- admin actions ---------------------------- */

function setViewerStatus(message, isError=false){
  const el = document.getElementById("vaStatus");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("is-error", Boolean(isError));
}

async function deleteCollectionDocs(collectionRef){
  for (;;){
    const snap = await collectionRef.limit(100).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach(d=>batch.delete(d.ref));
    await batch.commit();
  }
}

async function setupViewerAccessFromForm(){
  const code = normalizeDormCode(document.getElementById("vaCode").value);
  const dormName = document.getElementById("vaDormName").value.trim();
  const password = document.getElementById("vaPassword").value;
  const again = document.getElementById("vaPassword2").value;
  if (!isValidDormCode(code)){ setViewerStatus("The dorm code must be 4–30 characters: letters, numbers and dashes only.", true); return; }
  if (password.length < 8){ setViewerStatus("Use a password with at least 8 characters.", true); return; }
  if (password !== again){ setViewerStatus("The two passwords do not match.", true); return; }
  setViewerStatus("Setting up viewer access…");
  let dormCreated = false;
  try{
    const proof = await viewerProof(code, password);
    await dormRef(code).set({ownerUid:currentUser.uid, dormName, enabled:true, updatedAt:serverTime()});
    dormCreated = true;
    await db.collection("dormSecrets").doc(code).set({ownerUid:currentUser.uid, passwordHash:proof});
    await userCollection("settings").doc("viewerAccess").set({code, dormName, enabled:true});
  }catch(error){
    console.error("Viewer access setup failed", error);
    if (dormCreated) await dormRef(code).delete().catch(()=>{});
    setViewerStatus(error.code === "permission-denied"
      ? "That dorm code is already in use. Choose a different one."
      : "Could not set up viewer access: " + error.message, true);
  }
}

async function toggleViewerAccess(){
  if (!viewerAccess) return;
  const enabled = !viewerAccess.enabled;
  try{
    await dormRef(viewerAccess.code).update({enabled, updatedAt:serverTime()});
    await userCollection("settings").doc("viewerAccess").update({enabled});
    setViewerStatus(enabled ? "Viewer access is on." : "Viewer access is paused. Nobody can see or join until you turn it on.");
  }catch(error){
    console.error("Toggle viewer access failed", error);
    setViewerStatus("Could not change viewer access: " + error.message, true);
  }
}

async function changeViewerPassword(){
  if (!viewerAccess) return;
  const password = document.getElementById("vaNewPassword").value;
  const again = document.getElementById("vaNewPassword2").value;
  if (password.length < 8){ setViewerStatus("Use a password with at least 8 characters.", true); return; }
  if (password !== again){ setViewerStatus("The two passwords do not match.", true); return; }
  if (!confirm("Change the password?\n\nEveryone who joined will be removed and must enter the new password to join again.")) return;
  try{
    const code = viewerAccess.code;
    const proof = await viewerProof(code, password);
    await db.collection("dormSecrets").doc(code).update({passwordHash:proof});
    await deleteCollectionDocs(dormRef(code).collection("viewers"));
    document.getElementById("vaNewPassword").value = "";
    document.getElementById("vaNewPassword2").value = "";
    document.getElementById("vaPwBox").hidden = true;
    setViewerStatus("Password changed. All viewers were removed and must join again.");
  }catch(error){
    console.error("Change viewer password failed", error);
    setViewerStatus("Could not change the password: " + error.message, true);
  }
}

async function kickViewer(viewerId){
  if (!viewerAccess) return;
  const viewer = viewerList.find(item=>item.id===viewerId);
  if (!viewer) return;
  const label = viewer.name || viewer.email || "this viewer";
  if (!confirm("Remove " + label + "?\n\nThey lose access right away and cannot join again until you allow them.")) return;
  try{
    const dorm = dormRef(viewerAccess.code);
    const batch = db.batch();
    batch.delete(dorm.collection("viewers").doc(viewerId));
    batch.set(dorm.collection("blocked").doc(viewerId), {name:viewer.name||"", email:viewer.email||"", blockedAt:serverTime()});
    await batch.commit();
  }catch(error){
    console.error("Kick viewer failed", error);
    setViewerStatus("Could not remove the viewer: " + error.message, true);
  }
}

async function allowViewerAgain(viewerId){
  if (!viewerAccess) return;
  try{
    await dormRef(viewerAccess.code).collection("blocked").doc(viewerId).delete();
  }catch(error){
    console.error("Allow viewer failed", error);
    setViewerStatus("Could not allow the viewer again: " + error.message, true);
  }
}

async function removeViewerAccess(){
  if (!viewerAccess) return;
  if (!confirm("Turn off viewer access and delete the dorm code?\n\nAll viewers lose access. Your rooms and residents are not affected.")) return;
  const code = viewerAccess.code;
  const dorm = dormRef(code);
  try{
    for (const name of ["vacancy","viewers","blocked"]) await deleteCollectionDocs(dorm.collection(name));
    await db.collection("dormSecrets").doc(code).delete();
    await dorm.delete();
    await userCollection("settings").doc("viewerAccess").delete();
  }catch(error){
    console.error("Remove viewer access failed", error);
    setViewerStatus("Could not turn off viewer access: " + error.message, true);
  }
}

async function copyViewerLink(){
  const link = viewerPageUrl();
  try{
    await navigator.clipboard.writeText(link);
    setViewerStatus("Link copied.");
  }catch(error){
    setViewerStatus("Copy this link: " + link);
  }
}

/* ---------------------------- screen ---------------------------- */

function viewerSetupHtml(){
  return `<div class="va-card">
    <h3>Let people check vacancies without seeing resident data</h3>
    <p class="va-note">Choose a dorm code and a password. Viewers open the viewer page, sign in with Google, enter the code and password, and see only which rooms are vacant or full — no names or dates. You can remove any viewer later.</p>
    <div class="va-form">
      <div class="field"><label for="vaDormName">Dorm name (optional)</label><input type="text" id="vaDormName" maxlength="60" placeholder="e.g. Terrins Dormitory"></div>
      <div class="field"><label for="vaCode">Dorm code</label><input type="text" id="vaCode" maxlength="30" autocomplete="off" placeholder="e.g. terrins-dorm"></div>
      <div class="field"><label for="vaPassword">Password (8+ characters)</label><input type="password" id="vaPassword" autocomplete="new-password"></div>
      <div class="field"><label for="vaPassword2">Repeat password</label><input type="password" id="vaPassword2" autocomplete="new-password"></div>
    </div>
    <p class="va-note">Tip: make the code hard to guess and the password long. Anyone who knows both can join.</p>
    <button class="btn btn-primary" type="button" onclick="setupViewerAccessFromForm()">Turn on viewer access</button>
    <div class="va-status" id="vaStatus" role="status"></div>
  </div>`;
}

function viewerActiveHtml(){
  return `<div class="va-card">
    <div class="va-row">
      <div><div class="va-label">Dorm code</div><div class="va-big" id="vaCodeText"></div></div>
      <span class="status-tag" id="vaStateTag"></span>
    </div>
    <div class="va-row">
      <div class="va-grow"><div class="va-label">Viewer page link</div><div class="va-link" id="vaLinkText"></div></div>
      <button class="btn btn-outline btn-sm" type="button" onclick="copyViewerLink()">Copy link</button>
    </div>
    <p class="va-note">Give viewers the link, the dorm code and the password. The password is not stored anywhere readable, so if you forget it, set a new one.</p>
    <div class="va-actions">
      <button class="btn btn-outline btn-sm" type="button" id="vaToggleBtn" onclick="toggleViewerAccess()"></button>
      <button class="btn btn-outline btn-sm" type="button" onclick="document.getElementById('vaPwBox').hidden=false">Change password</button>
      <button class="btn btn-danger btn-sm" type="button" onclick="removeViewerAccess()">Turn off and delete</button>
    </div>
    <div class="va-pw" id="vaPwBox" hidden>
      <div class="va-form">
        <div class="field"><label for="vaNewPassword">New password (8+ characters)</label><input type="password" id="vaNewPassword" autocomplete="new-password"></div>
        <div class="field"><label for="vaNewPassword2">Repeat new password</label><input type="password" id="vaNewPassword2" autocomplete="new-password"></div>
      </div>
      <button class="btn btn-primary btn-sm" type="button" onclick="changeViewerPassword()">Save new password</button>
    </div>
    <div class="va-status" id="vaStatus" role="status"></div>
  </div>
  <h3 class="va-heading">Viewers <span id="vaViewerCount"></span></h3>
  <div id="vaViewers"></div>
  <h3 class="va-heading">Removed viewers</h3>
  <div id="vaBlocked"></div>`;
}

function formatJoined(value){
  const date = value && typeof value.toDate === "function" ? value.toDate() : null;
  return date ? date.toLocaleString([], {month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit"}) : "just now";
}

function fillViewerAccess(){
  document.getElementById("vaCodeText").textContent = viewerAccess.code + (viewerAccess.dormName ? " · " + viewerAccess.dormName : "");
  document.getElementById("vaLinkText").textContent = viewerPageUrl();
  const tag = document.getElementById("vaStateTag");
  tag.textContent = viewerAccess.enabled ? "On" : "Paused";
  tag.className = "status-tag " + (viewerAccess.enabled ? "matched" : "searching");
  document.getElementById("vaToggleBtn").textContent = viewerAccess.enabled ? "Pause access" : "Turn access back on";
  document.getElementById("vaViewerCount").textContent = "(" + viewerList.length + ")";

  const viewersHost = document.getElementById("vaViewers");
  viewersHost.innerHTML = viewerList.length
    ? `<div class="matrix-scroll"><table class="history-table"><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th></th></tr></thead><tbody>${
        viewerList.map(v=>`<tr><td><strong>${escapeHtml(v.name||"—")}</strong></td><td>${escapeHtml(v.email||"—")}</td><td>${formatJoined(v.joinedAt)}</td>
          <td style="text-align:right"><button class="btn btn-outline btn-sm" type="button" onclick="kickViewer('${escapeHtml(v.id)}')">Remove</button></td></tr>`).join("")
      }</tbody></table></div>`
    : `<div class="empty-note">Nobody has joined yet.</div>`;

  const blockedHost = document.getElementById("vaBlocked");
  blockedHost.innerHTML = blockedList.length
    ? `<div class="matrix-scroll"><table class="history-table"><tbody>${
        blockedList.map(v=>`<tr><td><strong>${escapeHtml(v.name||"—")}</strong></td><td>${escapeHtml(v.email||"—")}</td>
          <td style="text-align:right"><button class="btn btn-outline btn-sm" type="button" onclick="allowViewerAgain('${escapeHtml(v.id)}')">Allow again</button></td></tr>`).join("")
      }</tbody></table></div>`
    : `<div class="empty-note">No removed viewers.</div>`;
}

function renderViewerAccess(){
  const host = document.getElementById("viewerAccessPanel");
  if (!host) return;
  if (!viewerAccessLoaded){
    if (host.dataset.mode !== "loading"){
      host.dataset.mode = "loading";
      host.innerHTML = `<div class="empty-note">Loading…</div>`;
    }
    return;
  }
  const mode = viewerAccess ? "active" : "setup";
  if (host.dataset.mode !== mode){
    host.dataset.mode = mode;
    host.innerHTML = mode === "setup" ? viewerSetupHtml() : viewerActiveHtml();
  }
  if (mode === "active") fillViewerAccess();
}
