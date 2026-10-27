// js/10-analytics-calendar.js — Analytics, matrix and checkout calendar
/* ============================= RENDER: ANALYTICS ============================= */

function renderAnalytics(){
  const totalBeds = rooms.reduce((s,r)=>s+r.beds.length,0);
  const vacBeds = rooms.reduce((sum,r)=>sum+roomVacancy(r).vacant,0);
  const reservedBeds=rooms.reduce((sum,r)=>sum+roomVacancy(r).reserved,0);
  const occBeds=totalBeds-vacBeds-reservedBeds;
  const rate = totalBeds ? Math.round((occBeds/totalBeds)*100) : 0;

  const checkoutsWithin=days=>rooms.reduce((sum,r)=>sum+r.beds.filter(b=>{
    const end=parseScheduleDate(b.end,true);
    return Boolean(b.tenant && end && end.getTime()>=Date.now() && end.getTime()<=Date.now()+days*DAY_MS);
  }).length,0);
  const in30=checkoutsWithin(30),in60=checkoutsWithin(60),in90=checkoutsWithin(90);
  const due48=rooms.filter(room=>room.beds.some(b=>{
    const end=parseScheduleDate(b.end,true);
    return Boolean(b.tenant && end && end.getTime()>=Date.now() && end.getTime()<=Date.now()+2*DAY_MS);
  })).length;

  document.getElementById("analyticsTop").innerHTML = `
    <div class="stat-box"><div class="stat-num">${rate}%</div><div class="stat-label">Occupancy rate</div></div>
    <div class="stat-box accent"><div class="stat-num">${vacBeds}</div><div class="stat-label">Vacant beds</div></div>
    <div class="stat-box"><div class="stat-num">${reservedBeds}</div><div class="stat-label">Reserved beds</div></div>
    <div class="stat-box"><div class="stat-num">${due48}</div><div class="stat-label">Turnover rooms ≤48h</div></div>
    <div class="stat-box"><div class="stat-num">${in30}</div><div class="stat-label">Checking out ≤30d</div></div>
    <div class="stat-box"><div class="stat-num">${in90}</div><div class="stat-label">Checking out ≤90d</div></div>
  `;

  const byGender = {Male:0, Female:0, Mixed:0};
  rooms.forEach(r=>{ byGender[r.gender] = (byGender[r.gender]||0) + r.beds.length; });
  const maxG = Math.max(1, ...Object.values(byGender));
  document.getElementById("genderBars").innerHTML = Object.entries(byGender).map(([g,n])=>`
    <div class="bar-row"><div class="label">${g}</div><div class="bar-track"><div class="bar-fill" style="width:${(n/maxG)*100}%"></div></div><div class="val">${n}</div></div>
  `).join("");

  const byDemographic={Students:0,Reviewees:0,Mixed:0};
  rooms.forEach(r=>{byDemographic[r.demographic||"Mixed"]=(byDemographic[r.demographic||"Mixed"]||0)+r.beds.length;});
  const maxD=Math.max(1,...Object.values(byDemographic));
  document.getElementById("demographicBars").innerHTML=Object.entries(byDemographic).map(([group,count])=>`
    <div class="bar-row"><div class="label">${escapeHtml(group)}</div><div class="bar-track"><div class="bar-fill" style="width:${(count/maxD)*100}%"></div></div><div class="val">${count}</div></div>
  `).join("");

  const vacByRoom = rooms.map(r=>({room:r.room, vacant: roomVacancy(r).vacant})).filter(r=>r.vacant>0).sort((a,b)=>b.vacant-a.vacant);
  const maxV = Math.max(1, ...vacByRoom.map(r=>r.vacant));
  document.getElementById("vacancyBars").innerHTML = vacByRoom.length ? vacByRoom.map(r=>`
    <div class="bar-row"><div class="label">Room ${escapeHtml(r.room)}</div><div class="bar-track"><div class="bar-fill" style="width:${(r.vacant/maxV)*100}%"></div></div><div class="val">${r.vacant}</div></div>
  `).join("") : `<div class="empty-note">No vacant beds right now — full house.</div>`;

  document.getElementById("checkoutWindowBars").innerHTML = `
    <div class="bar-row"><div class="label">Next 30 days</div><div class="bar-track"><div class="bar-fill" style="width:${totalBeds?(in30/totalBeds)*100:0}%"></div></div><div class="val">${in30}</div></div>
    <div class="bar-row"><div class="label">Next 60 days</div><div class="bar-track"><div class="bar-fill" style="width:${totalBeds?(in60/totalBeds)*100:0}%"></div></div><div class="val">${in60}</div></div>
    <div class="bar-row"><div class="label">Next 90 days</div><div class="bar-track"><div class="bar-fill" style="width:${totalBeds?(in90/totalBeds)*100:0}%"></div></div><div class="val">${in90}</div></div>
  `;
}

/* ============================= RENDER: MATRIX ============================= */

function renderMatrix(){
  const maxCols = Math.max(1, ...rooms.map(r=>r.beds.length));
  const head = `<tr><th>Room</th>${Array.from({length:maxCols},(_,i)=>`<th>Bed ${i+1}</th>`).join("")}</tr>`;
  const body = rooms.map(r=>{
    const cells = Array.from({length:maxCols},(_,i)=>{
      const b = r.beds[i];
      if (!b) return `<td><div class="matrix-cell none"></div></td>`;
      const st = bedStatus(b,r);
      const cls = st;
      const label = ({vacant:"V",reserved:"R",temporary:"T",overdue:"!",soon:"!"})[st] || "";
      const title = b.tenant ? `${b.tenant} · ${fmtDate(b.start)} → ${fmtDate(b.end)}` : "Vacant";
      return `<td title="${escapeHtml(title)}"><div class="matrix-cell ${cls}">${label}</div></td>`;
    }).join("");
    return `<tr><td class="roomcell">${escapeHtml(r.room)}</td>${cells}</tr>`;
  }).join("");

  document.getElementById("matrixTable").innerHTML = head + body;
}

/* ============================= RENDER: CHECKOUT CALENDAR ============================= */

function renderCalendar(){
  const base = new Date();
  const target = new Date(base.getFullYear(), base.getMonth() + calOffset, 1);
  const monthLabel = target.toLocaleDateString([], {month:'long', year:'numeric'});
  document.getElementById("calTitle").textContent = monthLabel;

  const items = [];
  rooms.forEach(r=>{
    r.beds.forEach(b=>{
      if (!b.tenant || !b.end) return;
      const d = parseScheduleDate(b.end,true);
      if (!d) return;
      if (d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth()){
        items.push({room:r.room, tenant:b.tenant, date:b.end, reservedFor:b.reservedFor});
      }
    });
  });
  items.sort((a,b)=> a.date.localeCompare(b.date));

  const list = document.getElementById("checkoutList");
  if (!items.length){
    list.innerHTML = `<div class="empty-note">No checkouts scheduled for ${monthLabel}.</div>`;
    return;
  }
  list.innerHTML = items.map(it=>{
    const d = parseScheduleDate(it.date,true);
    if (!d) return "";
    const reservedProspect = it.reservedFor ? prospects.find(p=>p.id===it.reservedFor) : null;
    return `<div class="checkout-item">
      <div class="co-date">${d.toLocaleDateString([],{day:'2-digit'})}<br><small style="font-weight:500;font-size:10px;">${d.toLocaleDateString([],{month:'short'})}</small></div>
      <div class="co-info"><div class="tenant">${escapeHtml(it.tenant)}</div><div class="room">Room ${escapeHtml(it.room)}</div></div>
      ${reservedProspect ? `<span class="co-badge">Next: ${escapeHtml(reservedProspect.name)}</span>` : ''}
    </div>`;
  }).join("");
}

function calNav(delta){ calOffset += delta; renderCalendar(); }
function calToday(){ calOffset = 0; renderCalendar(); }

