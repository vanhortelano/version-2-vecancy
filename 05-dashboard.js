// js/05-dashboard.js — Dashboard: stats and room cards
/* ============================= RENDER: DASHBOARD ============================= */

function renderDashboard(){
  renderOverduePanel();
  const totalBeds = rooms.reduce((s,r)=>s + r.beds.length, 0);
  const allBeds = rooms.flatMap(r=>r.beds.map(b=>({room:r,bed:b})));
  const vacBeds = rooms.reduce((count,r)=>count+roomVacancy(r).vacant,0);
  const reservedBeds = rooms.reduce((count,r)=>count+roomVacancy(r).reserved,0);
  const overdueCount = allBeds.filter(({room,bed})=>bedStatus(bed,room)==="overdue").length;
  const temporaryCount = allBeds.filter(({room,bed})=>bedStatus(bed,room)==="temporary").length;
  const turnReady = rooms.filter(room=>room.beds.some(bed=>{
    const end = parseScheduleDate(bed.end, true);
    return Boolean(bed.tenant && end && end.getTime() >= Date.now() && end.getTime() <= Date.now()+48*60*60*1000);
  })).length;
  const occBeds = totalBeds-vacBeds-reservedBeds;
  const rate = totalBeds ? Math.round((occBeds/totalBeds)*100) : 0;
  const vacancyRate = totalBeds ? Math.round((vacBeds/totalBeds)*100) : 0;

  document.getElementById("statStrip").innerHTML = `
    <div class="stat-box"><div class="stat-num">${rooms.length}</div><div class="stat-label">Total rooms</div></div>
    <div class="stat-box"><div class="stat-num">${totalBeds}</div><div class="stat-label">Total beds</div></div>
    <div class="stat-box"><div class="stat-num">${occBeds}</div><div class="stat-label">Occupied / temporary</div></div>
    <div class="stat-box accent"><div class="stat-num">${vacBeds}</div><div class="stat-label">Vacant now</div></div>
    <div class="stat-box"><div class="stat-num">${rate}%</div><div class="stat-label">Occupancy rate</div></div>
    <div class="stat-box"><div class="stat-num">${vacancyRate}%</div><div class="stat-label">Vacancy rate</div></div>
    <div class="stat-box"><div class="stat-num">${reservedBeds}</div><div class="stat-label">Reserved</div></div>
    <div class="stat-box"><div class="stat-num">${turnReady}</div><div class="stat-label">Turnover rooms ≤48h</div></div>
    <div class="stat-box"><div class="stat-num">${overdueCount}</div><div class="stat-label">Overdue</div></div>
    <div class="stat-box"><div class="stat-num">${temporaryCount}</div><div class="stat-label">Temporary stays</div></div>
  `;

  const genderFilter = document.getElementById("filterGender").value;
  const vacFilter = document.getElementById("filterVacancy").value;
  const demographicFilter = document.getElementById("filterDemographic").value;
  const search = document.getElementById("filterSearch").value.trim().toLowerCase();

  let list = rooms.slice();
  if (genderFilter !== "all") list = list.filter(r=>r.gender === genderFilter);
  if (vacFilter === "vacant") list = list.filter(r=>roomVacancy(r).vacant > 0);
  if (vacFilter === "full") list = list.filter(r=>roomVacancy(r).vacant === 0);
  if (demographicFilter !== "all") list = list.filter(r=>demographicFilter === "Mixed"
    ? !["Students","Reviewees"].includes(r.demographic)
    : !r.demographic || r.demographic === "Mixed" || r.demographic === demographicFilter);
  if (search) list = list.filter(r=>{
    if ((r.room||"").toLowerCase().includes(search)) return true;
    return r.beds.some(b=>b.tenant && b.tenant.toLowerCase().includes(search));
  });

  const grid = document.getElementById("roomGrid");
  if (!list.length){
    grid.innerHTML = `<div class="empty-note">No rooms match. ${rooms.length===0 ? 'Click "Add room" to create your first room, or "Import my existing rooms" to load your spreadsheet data.' : 'Try clearing filters.'}</div>`;
    return;
  }

  grid.innerHTML = list.map(r=>{
    const {total, vacant, occupied} = roomVacancy(r);
    const pct = total ? Math.round((occupied/total)*100) : 0;
    const bedsHtml = r.beds.map((b, idx)=>{
      const st = bedStatus(b,r);
      const reservedProspect = b.reservedFor ? prospects.find(p=>p.id===b.reservedFor) : null;
      const pillLabels = {vacant:"Vacant", reserved:"Reserved", temporary:"Temporary", overdue:"Overdue", soon:"Checkout ≤48h", occupied:"Occupied"};
      const activeType = b.residentType || (r.demographic === "Reviewees" ? "Reviewee" : "Student");
      return `
        <div class="bed-row status-${st}">
          <div class="bed-slot">${b.slot}</div>
          <div class="bed-tenant">
            <span class="name ${b.tenant?'':'empty'}">${escapeHtml(b.tenant || 'Unassigned bed')}</span>
            <span class="dates">${b.tenant ? fmtDate(b.start) + ' → ' + fmtDate(b.end) : ''}</span>
            ${b.tenant ? `<span class="resident-type">${escapeHtml(activeType)}</span>` : ''}
            ${reservedProspect ? `<span class="reserved-tag">Reserved for ${escapeHtml(reservedProspect.name)} (in ${fmtDate(reservedProspect.checkIn)})</span>` : ''}
          </div>
          <div class="bed-row-actions"><span class="status-pill ${st}">${pillLabels[st]}</span>
            ${b.tenant && !b.temporaryClientId ? `<button class="btn btn-outline btn-sm" type="button" onclick="openExtendModal('${r.id}',${idx})">Extend</button>` : ''}
            ${b.tenant && !b.reservedFor ? `<button class="btn btn-outline btn-sm" type="button" onclick="openTransferModal('${r.id}',${idx})">Transfer</button>` : ''}
          </div>
        </div>`;
    }).join("");

    return `
      <div class="room-card">
        <div class="room-head">
          <div class="gender-bar ${r.gender}"></div>
          <div>
            <div class="room-code">${escapeHtml(r.room)}</div>
            <div class="room-meta">${escapeHtml(r.type || 'Room')} · ${escapeHtml(r.gender || 'Mixed')} · ${escapeHtml(r.demographic || 'Mixed')} · ${escapeHtml(r.tenancyMode || 'Bedspace')} · cap ${total}</div>
          </div>
          <div class="spacer"></div>
          <span class="vacancy-pill ${vacant>0?'has':'full'}">${vacant>0 ? vacant+' vacant' : 'Full'}</span>
          <button class="icon-btn" title="Edit room" onclick="openRoomModal('${r.id}')">✎</button>
          <button class="icon-btn" title="Delete room" onclick="deleteRoom('${r.id}')">🗑</button>
        </div>
        <div>${bedsHtml}</div>
        <div class="room-foot">
          <div class="vac-bar"><div class="vac-bar-fill" style="width:${pct}%"></div></div>
          <div class="vac-text">${occupied}/${total} filled</div>
        </div>
      </div>`;
  }).join("");
}

function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

