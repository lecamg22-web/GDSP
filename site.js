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
  const appRoot=$('#app');
  const slug=new URLSearchParams(location.search).get('event')||appRoot?.dataset.slug||'championnat-exemple';
  if(appRoot) try{ await loadEvent(slug); }catch(e){ appRoot.insertAdjacentHTML('beforeend',`<p role="alert">Service temporairement indisponible (${esc(e.message)})</p>`); }
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
function showAdminTab(name){
  $$('#atabs button').forEach(b=>b.classList.toggle('active',b.dataset.atab===name));
  $$('[data-apanel]').forEach(x=>x.hidden=x.dataset.apanel!==name);
}
async function renderCommission(){
  const panel=$('[data-apanel="commission"]'); if(!panel||!currentEvent||!token()) return;
  const ev=currentEvent, slug=currentSlug, drivers=allDrivers();
  const {pendingSessions}=await adminApi(`/api/admin/events/${encodeURIComponent(slug)}/commission`);
  const tab=$('[data-atab="commission"]'); if(tab) tab.textContent=`Commission (${pendingSessions.length})`;
  const pendingHtml=pendingSessions.map((s,i)=>`<article class="card" data-pending-card="${i}">
    <p class="eyebrow">À vérifier · ${esc(s.type)}</p><h3>${esc(s.track)}</h3>
    <div class="commission-fields"><label>Circuit <input data-field="track" value="${esc(s.track)}"></label>
    <label>Date <input data-field="date" value="${esc(s.date||'')}" placeholder="Date à confirmer"></label>
    <label>Type <select data-field="type"><option value="RACE" ${s.type==='RACE'?'selected':''}>RACE</option><option value="QUALIFY" ${s.type==='QUALIFY'?'selected':''}>QUALIFY</option></select></label></div>
    <div class="table-wrap"><table><thead><tr><th>Pos.</th><th>Pilote</th><th>Temps total (s)</th><th>Meilleur tour (s)</th><th>Pénalité (s)</th><th>DSQ</th></tr></thead><tbody>
    ${(s.results||[]).map((r,j)=>`<tr data-pending-result="${j}"><td data-label="Position"><input aria-label="Position du pilote ${j+1}" data-result="position" type="number" min="1" step="1" value="${r.position??j+1}"></td>
      <td data-label="Pilote"><input aria-label="Nom du pilote ${j+1}" data-result="driverName" value="${esc(r.driverName)}"></td>
      <td data-label="Temps total (s)"><input aria-label="Temps total du pilote ${j+1}" data-result="totalTimeSeconds" type="number" step="0.001" value="${r.totalTimeSeconds??''}"></td>
      <td data-label="Meilleur tour (s)"><input aria-label="Meilleur tour du pilote ${j+1}" data-result="bestLapSeconds" type="number" step="0.001" value="${r.bestLapSeconds??''}"></td>
      <td data-label="Pénalité (s)"><input aria-label="Pénalité du pilote ${j+1}" data-result="penaltySeconds" type="number" min="0" step="0.1" value="${r.penaltySeconds||0}"></td>
      <td data-label="Disqualification"><input aria-label="Disqualifier le pilote ${j+1}" data-result="disqualified" type="checkbox" ${r.disqualified?'checked':''}></td></tr>`).join('')||'<tr><td colspan="6">Aucun pilote dans cette session.</td></tr>'}
    </tbody></table></div><div class="commission-actions"><button data-save-pending="${i}">Enregistrer les modifications</button>
    <button data-publish-pending="${i}">Publier et calculer</button><button data-reject-pending="${i}">Écarter</button></div></article>`).join('')
    ||'<p class="empty-card">Aucune session en attente. Les prochains imports apparaîtront ici.</p>';
  const races=(ev.data.sessions||[]).filter(s=>s.type==='RACE');
  panel.innerHTML=`<h3>Commission de course — validation avant publication</h3>
    <p>Corrigez si nécessaire les positions, temps, noms ou pénalités. <strong>Publier et calculer</strong> rend la session visible et recalcule automatiquement les classements.</p>
    ${pendingHtml}<section class="section"><h3>Pénalités sur les courses publiées</h3>
    ${races.length?`<select id="pen-session">${races.map(r=>`<option value="${esc(r.date)}">${esc(r.track)} — ${esc(r.date||'Date à confirmer')}</option>`).join('')}</select>
    <select id="pen-driver">${[...drivers.entries()].map(([id,n])=>`<option value="${esc(id)}">${esc(n)}</option>`).join('')}</select>
    <input id="pen-seconds" type="number" min="0" step="1" placeholder="Secondes"><button id="pen-go">Appliquer</button>`:'<p>Publiez une course pour appliquer une pénalité.</p>'}
    ${Object.entries(ev.data.penMap||{}).map(([k,list])=>list.map(x=>`<div class="card">${esc(k)} · ${esc(drivers.get(x.driverId)||x.driverId)} : +${x.seconds}s
      <button data-del-pen="${esc(k)}|${esc(x.driverId)}">Retirer</button></div>`).join('')).join('')}</section>`;
  const savePending=async i=>{
    const card=$(`[data-pending-card="${i}"]`), session=structuredClone(pendingSessions[i]);
    for(const field of ['track','date','type']) session[field]=card.querySelector(`[data-field="${field}"]`).value||null;
    [...card.querySelectorAll('[data-pending-result]')].forEach(row=>{
      const r=session.results[Number(row.dataset.pendingResult)];
      for(const key of ['position','totalTimeSeconds','bestLapSeconds','penaltySeconds']){
        const value=row.querySelector(`[data-result="${key}"]`).value; r[key]=value===''?null:Number(value);
      }
      r.driverName=row.querySelector('[data-result="driverName"]').value;
      r.disqualified=row.querySelector('[data-result="disqualified"]').checked;
    });
    return adminApi(`/api/admin/events/${encodeURIComponent(slug)}/commission/${i}`,{method:'PUT',body:JSON.stringify({session})});
  };
  $$('[data-save-pending]').forEach(b=>b.addEventListener('click',async()=>{ await savePending(Number(b.dataset.savePending)); status('Modifications enregistrées dans la Commission'); await renderCommission(); }));
  $$('[data-publish-pending]').forEach(b=>b.addEventListener('click',async()=>{ const i=Number(b.dataset.publishPending);
    await savePending(i); await adminApi(`/api/admin/events/${encodeURIComponent(slug)}/commission/${i}/publish`,{method:'POST',body:'{}'});
    status('Session publiée — résultats et classements recalculés'); await loadEvent(slug); renderAdmin(); showAdminTab('commission'); }));
  $$('[data-reject-pending]').forEach(b=>b.addEventListener('click',async()=>{ const i=Number(b.dataset.rejectPending);
    if(!confirm('Écarter définitivement cette session importée ?')) return;
    await adminApi(`/api/admin/events/${encodeURIComponent(slug)}/commission/${i}`,{method:'DELETE'});
    status('Session écartée, sans publication'); await loadEvent(slug); renderAdmin(); showAdminTab('commission'); }));
  $('#pen-go')?.addEventListener('click',async()=>{ await adminApi(`/api/admin/events/${slug}/penalties`,{method:'POST',
    body:JSON.stringify({sessionKey:$('#pen-session').value,driverId:$('#pen-driver').value,seconds:Number($('#pen-seconds').value)||0})});
    status('Pénalité appliquée — classements recalculés'); await loadEvent(slug); renderAdmin(); showAdminTab('commission'); });
  $$('[data-del-pen]').forEach(b=>b.addEventListener('click',async()=>{ const [k,d]=b.dataset.delPen.split('|');
    await adminApi(`/api/admin/events/${slug}/penalties`,{method:'DELETE',body:JSON.stringify({sessionKey:k,driverId:d})}); await loadEvent(slug); renderAdmin(); showAdminTab('commission'); }));
}
function renderImports(){
  $('[data-apanel="imports"]').innerHTML=`<h3>Nouvel événement depuis AssettoHosting</h3>
    <p>L’événement est créé automatiquement avec son nom et son adresse. Les résultats restent privés dans la Commission jusqu’à votre validation.</p>
    <section class="card championship-import"><label for="ah-championships-url">Page des championnats</label>
      <input id="ah-championships-url" type="url" value="https://fr2.assettohosting.com:50648/championships">
      <button id="ah-list">Charger les championnats</button>
      <div id="ah-choice" hidden><label for="ah-championship">Championnat à importer</label><select id="ah-championship"></select>
        <label for="ah-kind">Section Événements</label><select id="ah-kind"><option value="championship">Championnat</option><option value="cup">Cup — mini-championnat</option><option value="open">Open</option></select>
        <button id="ah-import">Créer l’événement et importer</button></div><p id="ah-status" role="status"></p></section>
    ${currentEvent?`<section class="section"><h3>Ajouter des fichiers à « ${esc(currentEvent.name)} »</h3>
      <input type="file" id="imp-files" accept=".json" multiple><button id="imp-go">Envoyer à la Commission</button></section>`:''}`;
  $('#ah-list').onclick=async()=>{ const message=$('#ah-status'); message.textContent='Chargement…';
    try{ const list=await adminApi(`/api/admin/assettohosting/championships?url=${encodeURIComponent($('#ah-championships-url').value)}`);
      $('#ah-championship').innerHTML=list.map(c=>`<option value="${esc(c.url)}">${esc(c.name)} — ${c.eventCount} manche(s), ${Math.round(c.progress)}%</option>`).join('');
      $('#ah-choice').hidden=!list.length; message.textContent=`${list.length} championnat(s) trouvé(s)`;
    }catch(e){ message.textContent=`Import impossible : ${e.message}`; } };
  $('#ah-import').onclick=async()=>{ const message=$('#ah-status'); message.textContent='Création, import et anonymisation…';
    try{ const r=await adminApi('/api/admin/assettohosting/championships/import',{method:'POST',body:JSON.stringify({championshipUrl:$('#ah-championship').value,kind:$('#ah-kind').value})});
      status(`${r.event.name} créé : ${r.added} session(s) à vérifier, ${r.duplicates} doublon(s)`);
      await loadEvent(r.event.slug); renderAdmin(); showAdminTab('commission');
    }catch(e){ message.textContent=`Import impossible : ${e.message}`; } };
  $('#imp-go')?.addEventListener('click',async()=>{ const payloads=[]; for(const f of $('#imp-files').files) payloads.push(JSON.parse(await f.text()));
    const r=await adminApi(`/api/admin/events/${currentSlug}/import`,{method:'POST',body:JSON.stringify({payloads})});
    status(`${r.added} session(s) à vérifier, ${r.duplicates} doublon(s)`); await loadEvent(currentSlug); renderAdmin(); showAdminTab('commission'); });
}
async function renderEventManagement(){
  const events=await api('/api/events'), labels={championship:'Championnat',cup:'Cup',open:'Open',archive:'Archive'};
  $('[data-apanel="evenements"]').innerHTML=`<h3>Gestion des événements</h3><p>Archiver conserve tous les résultats. Réouvrir replace l’événement dans sa section d’origine.</p>`+
    (events.map(e=>`<article class="card event-admin"><div><strong>${esc(e.name)}</strong><br><small>${labels[e.kind]} · ${esc(e.slug)}</small></div><div class="event-admin-actions">
      ${e.kind==='archive'?`<button data-reopen="${esc(e.slug)}">Réouvrir</button>`:`<button data-archive="${esc(e.slug)}">Archiver</button>`}
      <button class="danger" data-delete="${esc(e.slug)}" data-name="${esc(e.name)}">Supprimer</button></div></article>`).join('')||'<p>Aucun événement.</p>');
  $$('[data-archive]').forEach(b=>b.onclick=async()=>{ await adminApi(`/api/admin/events/${b.dataset.archive}/kind`,{method:'PUT',body:JSON.stringify({kind:'archive'})}); status('Événement archivé'); await renderEventManagement(); });
  $$('[data-reopen]').forEach(b=>b.onclick=async()=>{ await adminApi(`/api/admin/events/${b.dataset.reopen}/kind`,{method:'PUT',body:JSON.stringify({reopen:true})}); status('Événement rouvert'); await renderEventManagement(); });
  $$('[data-delete]').forEach(b=>b.onclick=async()=>{ if(!confirm(`Supprimer définitivement « ${b.dataset.name} » et tous ses résultats ?`)) return;
    await adminApi(`/api/admin/events/${b.dataset.delete}`,{method:'DELETE'}); if(currentSlug===b.dataset.delete){ currentEvent=null; currentSlug=null; } status('Événement supprimé'); await renderEventManagement(); });
}
function renderAdmin(){
  if(!token()) return; $('#admin-body').hidden=false; renderImports(); renderEventManagement().catch(e=>status(e.message));
  if(!currentEvent) { $$('#atabs button').forEach(b=>b.onclick=()=>showAdminTab(b.dataset.atab)); return; }
  const ev=currentEvent, slug=currentSlug, drivers=allDrivers();
  // Les imports directs sont indépendants de l'événement courant (renderImports).
  // Manches
  $('[data-apanel="manches"]').innerHTML=`<h3>Manches (onglet Circuit)</h3>`+
    ((ev.data.circuitRounds||[]).map(r=>`<div class="card">${esc(r.id)} — ${esc(r.label||TBC)} · ${esc(r.date||'Date à confirmer')}
      <button data-del-round="${esc(r.id)}">Supprimer</button></div>`).join('')||`<p>${TBC} — ajoutez une fiche via l'onglet Circuits.</p>`);
  $$('[data-del-round]').forEach(b=>b.addEventListener('click',async()=>{ await adminApi(`/api/admin/events/${slug}/circuits/${encodeURIComponent(b.dataset.delRound)}`,{method:'DELETE'}); await loadEvent(slug); renderAdmin(); }));
  // Commission: correction des brouillons, publication et pénalités après publication
  renderCommission().catch(e=>status(`Commission indisponible : ${e.message}`));
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
  // La création et la gestion des événements sont globales (renderEventManagement).
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
  $$('#atabs button').forEach(b=>b.onclick=()=>showAdminTab(b.dataset.atab));
}
