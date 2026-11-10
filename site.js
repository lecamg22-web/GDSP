'use strict';
/* GDSP front — vanilla JS, no build. Talks ONLY to /api/* (proxied by frontend server). */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const TBC='à confirmer';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path, opts={}){ const r=await fetch(path,opts); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.status===204?null:r.json(); }
function svgPath(points){
  if(!points||!points.length) return '';
  const xs=points.map(p=>p.x), zs=points.map(p=>p.z), minX=Math.min(...xs), maxX=Math.max(...xs), minZ=Math.min(...zs), maxZ=Math.max(...zs);
  const s=Math.min(560/((maxX-minX)||1),360/((maxZ-minZ)||1));
  return 'M'+points.map(p=>`${(20+(p.x-minX)*s).toFixed(1)},${(380-(p.z-minZ)*s).toFixed(1)}`).join(' L')+' Z';
}
function renderCircuit(round){
  const corners=(round.corners||[]).map(c=>{
    const p=(round.layout.points||[]).reduce((best,q)=>Math.abs(q.lapFraction-c.lapFraction)<Math.abs(best.lapFraction-c.lapFraction)?q:best, round.layout.points[0]||{x:0,z:0});
    return `<text x="10" y="${14*c.number}">${c.number}. virage (fraction ${c.lapFraction})</text>`; }).join('');
  const sectors=(round.sectors||[]).map(s=>`<li>Secteur ${s.number} : ${Math.round(s.startFraction*100)}% → ${Math.round(s.endFraction*100)}%</li>`).join('');
  const surfaces=(round.surfaces||[]).map(s=>`<li>${esc(s.name)} — friction ${s.friction??TBC}, validité ${esc(s.validity??TBC)}</li>`).join('');
  const elev=(round.elevation||[]).map(e=>`${Math.round(e.lapFraction*600)},${Math.round(120-e.altitude)}`).join(' ');
  return `<article class="card"><h3>${esc(round.id)} — ${esc(round.label||TBC)}</h3>
  <p>Date : ${esc(round.date||'Date à confirmer')} · Vainqueur : ${esc(round.winner||TBC)} · Stands : ${esc(round.pitCapacityLabel||TBC)}</p>
  <svg viewBox="0 0 600 400" role="img" aria-label="Tracé"><path d="${svgPath(round.layout.points)}" fill="none" stroke="#cd9a42" stroke-width="3"/></svg>
  <svg viewBox="0 0 600 140" role="img" aria-label="Profil altimétrique"><polyline points="${elev}" fill="none" stroke="#7ac"/></svg>
  <h4>Virages numérotés</h4><ol>${(round.corners||[]).map(c=>`<li>Virage ${c.number} — fraction de tour ${c.lapFraction}</li>`).join('')||`<li>${TBC}</li>`}</ol>
  <h4>Secteurs</h4><ul>${sectors||`<li>${TBC}</li>`}</ul><h4>Surfaces</h4><ul>${surfaces||`<li>${TBC}</li>`}</ul></article>`;
}
let currentEvent=null, currentSlug=null, lastDriveRound=null;
async function loadEvent(slug){
  const event=await api(`/api/events/${encodeURIComponent(slug)}`);
  currentEvent=event; currentSlug=slug;
  const standings=await api(`/api/events/${encodeURIComponent(slug)}/standings`);
  const info=event.data.eventInfo||{}; // strictly this event's labels — no cross-event leakage
  $('[data-panel="infos"]').innerHTML=`<h2>${esc(event.name)}</h2><p>${esc(info.description||TBC)}</p>
    ${info.plateau?`<p>Plateau : ${esc(info.plateau)}</p>`:''}
    ${event.data.posterImage?`<img src="${esc(event.data.posterImage)}" alt="Affiche">`:''}
    <h3>Calendrier</h3><ul>${Object.entries(event.data.customCalendar||{}).map(([k,v])=>`<li>${esc(k)} : ${esc(v||'Date à confirmer')}</li>`).join('')||'<li>Date à confirmer</li>'}</ul>
    <h3>Galerie</h3>${(event.data.galleryImages||[]).map(src=>`<img src="${esc(src)}" alt="">`).join('')||TBC}`;
  $('[data-panel="standings"]').innerHTML=`<table><thead><tr><th>#</th><th>Pilote</th><th>Points</th><th>Victoires</th></tr></thead><tbody>${
    standings.map(r=>`<tr><td>${r.position}</td><td>${esc(r.driverName)}</td><td>${r.total}</td><td>${r.wins}</td></tr>`).join('')}</tbody></table>`;
  const races=(event.data.sessions||[]).filter(s=>s.type==='RACE');
  $('[data-panel="results"]').innerHTML=`<label>Manche <select id="race-select">${races.map((r,i)=>`<option value="${i}">${esc(r.track)} — ${esc(r.date||'Date à confirmer')}</option>`).join('')}</select></label><div id="race-detail"></div>`;
  const drawRace=i=>{ const r=races[i]; $('#race-detail').innerHTML=r?`<table><tbody>${[...r.results].sort((a,b)=>a.position-b.position).map(x=>`<tr><td>${x.position}</td><td>${esc(x.driverName)}</td></tr>`).join('')}</tbody></table>`:TBC; };
  const sel=$('#race-select'); if(sel){ sel.addEventListener('change',()=>drawRace(+sel.value)); drawRace(0); }
  const rounds=event.data.circuitRounds||[];
  $('#tab-circuit').hidden = rounds.length===0; // hidden until at least one round exists, for ANY event
  $('[data-panel="circuit"]').innerHTML = rounds.length
    ? `<label>Manche <select id="round-select">${rounds.map((r,i)=>`<option value="${i}">${esc(r.id)}</option>`).join('')}</select></label><div id="round-detail"></div>` : '';
  const drawRound=i=>{ const el=$('#round-detail'); if(el) el.innerHTML=renderCircuit(rounds[i]); };
  const rsel=$('#round-select'); if(rsel){ rsel.addEventListener('change',()=>drawRound(+rsel.value)); drawRound(0); }
  const drivers=new Map(); for(const s of event.data.sessions||[]) for(const r of s.results||[]) drivers.set(r.driverId,r.driverName);
  $('[data-panel="drivers"]').innerHTML=[...drivers.entries()].map(([id,name])=>`<div class="card"><h3>${esc((event.data.manualDrivers||{})[id]||name)}</h3><p>Identifiant pseudonymisé : ${esc(id)}</p><button data-driver="${esc(id)}">Voir le profil</button><div data-profile="${esc(id)}"></div></div>`).join('')||TBC;
  $$('[data-driver]').forEach(b=>b.addEventListener('click',async()=>{
    const prof=await api(`/api/events/${encodeURIComponent(slug)}/drivers/${encodeURIComponent(b.dataset.driver)}`);
    const races=prof.sessions.filter(s=>s.type==='RACE');
    $(`[data-profile="${CSS.escape(b.dataset.driver)}"]`).innerHTML=
      `<p>${races.length} course(s) · meilleur résultat : ${races.length?('P'+Math.min(...races.flatMap(s=>s.results.filter(r=>r.driverId===b.dataset.driver).map(r=>r.position)))):TBC}</p>`+
      races.map(s=>`<p>${esc(s.track)} — ${esc(s.date||'Date à confirmer')}</p>`).join(''); }));
  return event;
}
function initTabs(){ $$('#tabs button').forEach(b=>b.addEventListener('click',()=>{
  $$('#tabs button').forEach(x=>x.classList.toggle('active',x===b));
  $$('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==b.dataset.tab); })); }
async function init(){
  initTabs();
  const slug=new URLSearchParams(location.search).get('event')||document.querySelector('[data-slug]')?.dataset.slug||'championnat-exemple';
  try{ await loadEvent(slug); }catch(e){ $('#app').insertAdjacentHTML('beforeend',`<p role="alert">Service temporairement indisponible (${esc(e.message)})</p>`); }
  const login=$('#login'); if(login) login.addEventListener('submit',async ev=>{ ev.preventDefault();
    const fd=new FormData(login); const data=await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(fd))});
    localStorage.setItem('gdsp-token',data.token); $('#admin-body').hidden=false; renderAdmin(); status('Connecté'); });
  const drive=$('#drive-import'); if(drive) drive.addEventListener('submit',async ev=>{ ev.preventDefault();
    const fd=new FormData(drive);
    const round=await api(`/api/admin/events/${encodeURIComponent(slug)}/circuits/drive/preview`,{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('gdsp-token')||''}`},
      body:JSON.stringify({folderUrl:fd.get('folderUrl'),roundId:'M1'})});
    lastDriveRound=round; $('#drive-preview').innerHTML=renderCircuit(round); });
  const dsave=$('#drive-save'); if(dsave) dsave.addEventListener('click',async()=>{ if(!lastDriveRound) return alert('Générez d’abord un aperçu Drive');
    await adminApi(`/api/admin/events/${encodeURIComponent(slug)}/circuits`,{method:'POST',body:JSON.stringify(lastDriveRound)}); status('Fiche circuit enregistrée'); await loadEvent(slug); renderAdmin(); });
}
document.addEventListener('DOMContentLoaded',init);

/* ---------- Administration (jeton Bearer, aucun appel direct à la base) ---------- */
function token(){ return localStorage.getItem('gdsp-token')||''; }
function status(msg){ const el=$('#admin-status'); if(el) el.textContent=msg; }
async function adminApi(path, opts={}){ const r=await fetch(path,{...opts,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token()}`,...(opts.headers||{})}});
  if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.status===204?null:r.json(); }
function allDrivers(){ const m=new Map(); for(const s of currentEvent?.data.sessions||[]) for(const r of s.results||[]) m.set(r.driverId,(currentEvent.data.manualDrivers||{})[r.driverId]||r.driverName); return m; }
function renderAdmin(){
  if(!currentEvent||!token()) return; $('#admin-body').hidden=false;
  const ev=currentEvent, slug=currentSlug, drivers=allDrivers();
  // Imports: unitaire ou en masse, fichiers JSON AssettoHosting
  $('[data-apanel="imports"]').innerHTML=`<h3>Imports de résultats</h3>
    <input type="file" id="imp-files" accept=".json" multiple><button id="imp-go">Importer</button>
    <button id="imp-scan">Scanner les serveurs AssettoHosting configurés</button>`;
  $('#imp-go').addEventListener('click',async()=>{ const files=[...$('#imp-files').files];
    const payloads=[]; for(const f of files) payloads.push(JSON.parse(await f.text()));
    const r=await adminApi(`/api/admin/events/${slug}/import`,{method:'POST',body:JSON.stringify({payloads})});
    status(`${r.added} session(s) ajoutée(s), ${r.duplicates} doublon(s) écarté(s)`); await loadEvent(slug); renderAdmin(); });
  $('#imp-scan').addEventListener('click',async()=>{ const r=await adminApi(`/api/admin/events/${slug}/servers/scan`,{method:'POST',body:'{}'});
    status(`Scan AH : ${r.added} ajoutée(s), ${r.duplicates} doublon(s)`); await loadEvent(slug); renderAdmin(); });
  // Manches
  $('[data-apanel="manches"]').innerHTML=`<h3>Manches (onglet Circuit)</h3>`+
    ((ev.data.circuitRounds||[]).map(r=>`<div class="card">${esc(r.id)} — ${esc(r.label||TBC)} · ${esc(r.date||'Date à confirmer')}
      <button data-del-round="${esc(r.id)}">Supprimer</button></div>`).join('')||`<p>${TBC} — ajoutez une fiche via l'onglet Circuits.</p>`);
  $$('[data-del-round]').forEach(b=>b.addEventListener('click',async()=>{ await adminApi(`/api/admin/events/${slug}/circuits/${encodeURIComponent(b.dataset.delRound)}`,{method:'DELETE'}); await loadEvent(slug); renderAdmin(); }));
  // Commission: pénalités en secondes, reclassement automatique
  const races=(ev.data.sessions||[]).filter(s=>s.type==='RACE');
  $('[data-apanel="commission"]').innerHTML=`<h3>Commission — pénalités</h3>
    <select id="pen-session">${races.map(r=>`<option value="${esc(r.date)}">${esc(r.track)} — ${esc(r.date||'Date à confirmer')}</option>`).join('')}</select>
    <select id="pen-driver">${[...drivers.entries()].map(([id,n])=>`<option value="${esc(id)}">${esc(n)}</option>`).join('')}</select>
    <input id="pen-seconds" type="number" min="0" step="1" placeholder="Secondes"><button id="pen-go">Appliquer</button>
    ${Object.entries(ev.data.penMap||{}).map(([k,list])=>list.map(x=>`<div class="card">${esc(k)} · ${esc(drivers.get(x.driverId)||x.driverId)} : +${x.seconds}s
      <button data-del-pen="${esc(k)}|${esc(x.driverId)}">Retirer</button></div>`).join('')).join('')}`;
  $('#pen-go')?.addEventListener('click',async()=>{ await adminApi(`/api/admin/events/${slug}/penalties`,{method:'POST',
    body:JSON.stringify({sessionKey:$('#pen-session').value,driverId:$('#pen-driver').value,seconds:Number($('#pen-seconds').value)||0})});
    status('Pénalité appliquée — classements recalculés'); await loadEvent(slug); renderAdmin(); });
  $$('[data-del-pen]').forEach(b=>b.addEventListener('click',async()=>{ const [k,d]=b.dataset.delPen.split('|');
    await adminApi(`/api/admin/events/${slug}/penalties`,{method:'DELETE',body:JSON.stringify({sessionKey:k,driverId:d})}); await loadEvent(slug); renderAdmin(); }));
  // Pilotes: noms affichés librement choisis (manualDrivers), identifiants pseudonymisés figés
  $('[data-apanel="pilotes"]').innerHTML=`<h3>Pilotes</h3>`+[...drivers.entries()].map(([id,n])=>
    `<div class="card"><code>${esc(id)}</code> <input data-driver-name="${esc(id)}" value="${esc(n)}"></div>`).join('')+
    `<button id="drivers-save">Enregistrer les noms</button>`;
  $('#drivers-save')?.addEventListener('click',async()=>{ const manual={};
    $$('[data-driver-name]').forEach(i=>manual[i.dataset.driverName]=i.value);
    await adminApi(`/api/admin/events/${slug}/drivers`,{method:'PUT',body:JSON.stringify({manualDrivers:manual})});
    status('Noms enregistrés'); await loadEvent(slug); renderAdmin(); });
  // Données: export / réimport JSON complet de l'événement
  $('[data-apanel="donnees"]').innerHTML=`<h3>Données</h3><button id="data-export">Exporter (JSON)</button>
    <textarea id="data-import" rows="6" cols="70" placeholder="Coller un événement JSON complet"></textarea>
    <button id="data-go">Réimporter</button> <button id="data-del">Supprimer l'événement</button>`;
  $('#data-export').addEventListener('click',()=>{ const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([JSON.stringify(ev,null,2)],{type:'application/json'})); a.download=`${slug}.json`; a.click(); });
  $('#data-go').addEventListener('click',async()=>{ await adminApi(`/api/admin/events/${slug}`,{method:'PUT',body:$('#data-import').value});
    status('Données réimportées'); await loadEvent(slug); renderAdmin(); });
  $('#data-del').addEventListener('click',async()=>{ if(confirm('Supprimer cet événement ?')){ await adminApi(`/api/admin/events/${slug}`,{method:'DELETE'}); status('Événement supprimé'); } });
  // Événements
  $('[data-apanel="evenements"]').innerHTML=`<h3>Événements</h3>
    <input id="ev-slug" placeholder="slug"><input id="ev-name" placeholder="Nom">
    <select id="ev-kind"><option value="championship">championship</option><option value="open">open</option><option value="archive">archive</option></select>
    <button id="ev-go">Créer</button>`;
  $('#ev-go').addEventListener('click',async()=>{ await adminApi('/api/admin/events',{method:'POST',
    body:JSON.stringify({slug:$('#ev-slug').value,name:$('#ev-name').value,kind:$('#ev-kind').value})}); status('Événement créé'); });
  // Serveurs AH
  const servers=ev.data.serversAH||[];
  $('[data-apanel="serveurs"]').innerHTML=`<h3>Serveurs AssettoHosting</h3>`+servers.map((s,i)=>
    `<div class="card"><input data-srv-name="${i}" value="${esc(s.name||'')}"> <input data-srv-url="${i}" value="${esc(s.url||s.resultsUrl||'')}" size="50"></div>`).join('')+
    `<button id="srv-add">Ajouter un serveur</button> <button id="srv-save">Enregistrer</button>`;
  const collectServers=()=>[...document.querySelectorAll('[data-srv-url]')].map(u=>({name:$(`[data-srv-name="${u.dataset.srvUrl}"]`).value,url:u.value}));
  $('#srv-add').addEventListener('click',async()=>{ servers.push({name:'',url:''}); await adminApi(`/api/admin/events/${slug}/servers`,{method:'PUT',body:JSON.stringify({servers})}); await loadEvent(slug); renderAdmin(); });
  $('#srv-save').addEventListener('click',async()=>{ await adminApi(`/api/admin/events/${slug}/servers`,{method:'PUT',body:JSON.stringify({servers:collectServers()})}); status('Serveurs enregistrés'); });
  // Global: exclusions du classement Discord
  adminApi('/api/admin/global/exclusions').then(({globalExclusions=[]})=>{
    $('[data-apanel="global"]').innerHTML=`<h3>Global — exclusions</h3>`+[...drivers.entries()].map(([id,n])=>
      `<label><input type="checkbox" data-excl="${esc(id)}" ${globalExclusions.includes(id)?'checked':''}> ${esc(n)}</label><br>`).join('')+
      `<button id="excl-save">Enregistrer les exclusions</button>`;
    $('#excl-save').addEventListener('click',async()=>{ const list=$$('[data-excl]').filter(c=>c.checked).map(c=>c.dataset.excl);
      await adminApi('/api/admin/global/exclusions',{method:'PUT',body:JSON.stringify({globalExclusions:list})}); status('Exclusions enregistrées'); });
  }).catch(()=>{});
  // Admin tab switching
  $$('#atabs button').forEach(b=>b.onclick=()=>{ $$('[data-apanel]').forEach(x=>x.hidden=x.dataset.apanel!==b.dataset.atab); });
}
