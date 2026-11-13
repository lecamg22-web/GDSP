'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path');
const {pseudonymize,anonymize,assertNoGuid}=require('../backend/lib/anonymize');
const {pointsForResult,applyJokers}=require('../backend/lib/points');
const {applyPenalties}=require('../backend/lib/penalties');
const {computeStandings}=require('../backend/lib/standings');
const {computeGlobalRatings,regularityScore,levelFor,recencyWeight}=require('../backend/lib/globalRating');
const {normalizeSession,mergeSessions}=require('../backend/lib/importResult');
const {parseFastLane,compactFastLane,detectCorners}=require('../tools/lib/fastLane');
const {parseSurfaces,parseSectors,validateSectors}=require('../tools/lib/modFiles');
const {parseDriveFolderHtml,pickCircuitFiles,extractFolderId,extractFolderRef,folderEmbedUrl,downloadUrl,fetchText}=require('../tools/lib/drive');
const {buildCircuitRound}=require('../backend/lib/circuit');
const {createApp,validateEvent}=require('../backend/app');
const {MemoryStore,seedIfEmpty}=require('../backend/lib/store');
const {createFrontendApp}=require('../frontend/app');
const {createUnifiedApp}=require('../server');
const {parseChampionshipsHtml,extractChampionshipSessions,championshipExportUrl}=require('../backend/lib/ahChampionships');

const GUID='76561198000000001';
test('anonymisation: déterministe, irréversible en apparence, aucun GUID résiduel',()=>{
  assert.equal(pseudonymize(GUID),pseudonymize(GUID)); assert.notEqual(pseudonymize(GUID),GUID);
  assert.match(pseudonymize(GUID),/^pilote-[0-9a-f]{12}$/);
  const clean=anonymize({DriverGuid:GUID,nested:[GUID]}); assert.doesNotMatch(JSON.stringify(clean),/7656119/);
  assert.throws(()=>assertNoGuid({x:GUID}));
});
test('points: barème, coefficient, pôle, distance minimale',()=>{
  const cfg={scale:[25,18],polePoints:3,coefficient:2,minDistancePercent:75,jokers:0};
  assert.equal(pointsForResult({position:1,distancePercent:100},cfg,{isPole:true}),(25+3)*2);
  assert.equal(pointsForResult({position:1,distancePercent:50},cfg),0);
  assert.equal(pointsForResult({position:9,distancePercent:100},cfg),0);
});
test('jokers: les N plus mauvais tours sont écartés',()=>{
  const r=applyJokers([25,0,10,18],1); assert.equal(r.total,53); assert.deepEqual(r.droppedRoundIndexes,[1]);
});
test('pénalités Commission: reclassement automatique sans mutation',()=>{
  const input=[{driverId:'a',totalTimeSeconds:100},{driverId:'b',totalTimeSeconds:105}];
  const out=applyPenalties(input,[{driverId:'a',seconds:10}]);
  assert.equal(out[0].driverId,'b'); assert.equal(out[0].position,1); assert.equal(input[0].driverId,'a');
});
function makeFastLaneBuffer(n=2000){
  const buf=Buffer.alloc(16+n*20); buf.writeInt32LE(4,0); buf.writeInt32LE(n,4);
  let dist=0;
  for(let i=0;i<n;i++){ const t=i/n*Math.PI*2*3; const x=Math.cos(t)*500+Math.sin(t*3)*40, z=Math.sin(t)*300, y=Math.sin(t*2)*10;
    if(i) dist+=10; const o=16+i*20; buf.writeFloatLE(x,o); buf.writeFloatLE(y,o+4); buf.writeFloatLE(z,o+8); buf.writeFloatLE(dist,o+12); buf.writeUInt32LE(i,o+16); }
  return buf;
}
test('fast_lane.ai: parsing binaire en-tête 16o + enregistrements 20o',()=>{
  const p=parseFastLane(makeFastLaneBuffer(50)); assert.equal(p.count,50); assert.equal(p.points.length,50);
  assert.throws(()=>parseFastLane(Buffer.alloc(10)),/tronqué/);
});
test('compaction: ~220 points à 0,1m, virages détectés AVANT décimation',()=>{
  const parsed=parseFastLane(makeFastLaneBuffer(6000)); const compact=compactFastLane(parsed);
  assert.ok(compact.pointCount>=200&&compact.pointCount<=240, `points=${compact.pointCount}`);
  assert.ok(compact.corners.length>=5, `corners=${compact.corners.length} (une détection après décimation en fusionnerait la plupart)`);
  for(const p of compact.points) assert.equal(Math.round(p.x*10)/10,p.x);
  for(const c of compact.corners) assert.ok(c.lapFraction>=0&&c.lapFraction<=1);
});
test('surfaces.ini: le nom vient de KEY=, pas de [SURFACE_0]',()=>{
  const s=parseSurfaces('[SURFACE_0]\nKEY=ROAD\nFRICTION=0.99\nIS_VALID_TRACK=1\n');
  assert.equal(s[0].name,'ROAD'); assert.equal(s[0].friction,0.99); assert.equal(s[0].isValidTrack,true);
});
test('overlays.ini: 3 départs = 3 secteurs couvrant tout le tour',()=>{
  const sectors=parseSectors('[SECTOR_0]\nSTART=0\n[SECTOR_1]\nSTART=1000\n[SECTOR_2]\nSTART=2500\n',4000);
  assert.equal(sectors.length,3); assert.equal(sectors[2].endFraction,1); assert.ok(validateSectors(sectors));
});
test('fiche circuit: date/vainqueur absents => à confirmer, jamais inventés',()=>{
  const round=buildCircuitRound({roundId:'M2',fastLaneBuffer:makeFastLaneBuffer(),overlaysText:'[SECTOR_0]\nSTART=0\n',uiTrackText:JSON.stringify({name:'Spa',pitboxes:24})});
  assert.equal(round.dateLabel,'Date à confirmer'); assert.equal(round.winnerLabel,'À confirmer'); assert.equal(round.pitCapacity,24);
  assert.equal(round.sectors[round.sectors.length-1].endFraction,1);
});
test('import: PRACTICE/test écartés, doublon (date+type) détecté, GUID pseudonymisé',()=>{
  assert.equal(normalizeSession({Type:'PRACTICE',Results:[]}),null);
  assert.equal(normalizeSession({Type:'RACE',SessionName:'test server',Results:[]}),null);
  const raw={Date:'2026-01-01T20:00:00',Type:'RACE',Track:'Spa',Results:[{DriverGuid:GUID,DriverName:'Alice',Position:1,TotalTime:6000000}]};
  const s=normalizeSession(raw); assert.doesNotMatch(JSON.stringify(s),/7656119/);
  const merged=mergeSessions([s],[s]); assert.equal(merged.added.length,0); assert.equal(merged.duplicates.length,1);
});
test('classement général avec jokers',()=>{
  const ev={slug:'x',kind:'championship',points_config:{scale:[25,18],polePoints:0,coefficient:1,jokers:1,minDistancePercent:0},
    data:{sessions:[
      {type:'RACE',date:'2026-01-01',track:'a',results:[{driverId:'a',driverName:'A',position:1,totalTimeSeconds:100},{driverId:'b',driverName:'B',position:2,totalTimeSeconds:101}]},
      {type:'RACE',date:'2026-01-08',track:'b',results:[{driverId:'b',driverName:'B',position:1,totalTimeSeconds:100},{driverId:'a',driverName:'A',position:2,totalTimeSeconds:101}]}],
      penMap:{},circuitRounds:[]}};
  const st=computeStandings(ev); // each drops worst round: A drops 18 ->25, B drops 18 ->25, tie -> wins equal -> name
  assert.equal(st[0].total,25); assert.equal(st.length,2);
});
test('régularité iRacing: 1er tour et tours >+21s exclus',()=>{
  const laps=[{number:1,timeSeconds:999},{number:2,timeSeconds:100},{number:3,timeSeconds:101},{number:4,timeSeconds:102},{number:5,timeSeconds:200}];
  assert.equal(regularityScore(laps),81.25);
});
test('global: pondération 90j, niveaux, minimum 5 courses',()=>{
  assert.equal(recencyWeight(new Date(Date.now()-90*86400000)),0.5);
  assert.equal(levelFor(40),'Débutant'); assert.equal(levelFor(41),'Intermédiaire'); assert.equal(levelFor(81),'Élite');
  const race=(d,i)=>({type:'RACE',date:d,track:'t'+i,results:[{driverId:'a',driverName:'A',position:1,totalTimeSeconds:100,bestLapSeconds:90},{driverId:'b',driverName:'B',position:2,totalTimeSeconds:110,bestLapSeconds:95}],
    laps:[2,3,4].map(n=>({driverId:'a',number:n,timeSeconds:90+n})),events:[]});
  const ev={slug:'g',data:{sessions:[0,1,2].map(i=>race('2026-01-01',i)),penMap:{}}};
  const ratings=computeGlobalRatings([ev],{now:new Date('2026-01-02')});
  assert.equal(ratings.find(r=>r.driverId==='a').ranked,false); // only 3 races < 5
});
test('drive: id dossier, parsing dossier public, fast_lane obligatoire et resource keys',async()=>{
  assert.equal(extractFolderId('https://drive.google.com/drive/folders/ABC1234567_-x'),'ABC1234567_-x');
  const files=parseDriveFolderHtml('<div data-id="FILEID123456"><span class="flip-entry-title">fast_lane.ai</span></div>');
  assert.equal(files[0].name,'fast_lane.ai'); assert.equal(pickCircuitFiles(files).fastLane.id,'FILEID123456');
  assert.throws(()=>pickCircuitFiles([{id:'x',name:'surfaces.ini'}]),/fast_lane\.ai/);
  assert.deepEqual(extractFolderRef('https://drive.google.com/drive/folders/FOLDERID12345?resourcekey=FOLDERKEY12345'),{id:'FOLDERID12345',resourceKey:'FOLDERKEY12345'});
  assert.equal(folderEmbedUrl('FOLDERID12345','FOLDERKEY12345'),'https://drive.google.com/embeddedfolderview?id=FOLDERID12345&resourcekey=FOLDERKEY12345#list');
  assert.equal(downloadUrl('FILEID123456','FILEKEY123456'),'https://drive.google.com/uc?export=download&id=FILEID123456&resourcekey=FILEKEY123456');
  await assert.rejects(fetchText('https://drive.google.com/example',async()=>new Response('',{status:401})),/Tous les utilisateurs disposant du lien/);
});
test('aperçu circuit Drive: récupère le tracé pour l’événement sélectionné',async()=>{
  process.env.ADMIN_USERNAME='admin'; process.env.ADMIN_PASSWORD='secret';
  const bytes=Buffer.alloc(36); bytes.writeInt32LE(1,4);
  bytes.writeFloatLE(10,16); bytes.writeFloatLE(3,20); bytes.writeFloatLE(20,24); bytes.writeFloatLE(100,28); bytes.writeUInt32LE(1,32);
  const requested=[];
  const fetchFn=async url=>{ requested.push(url); return url.includes('embeddedfolderview')
    ?new Response('<div data-id="FILEID123456"><span class="flip-entry-title">fast_lane.ai</span><span data-resourcekey="FILEKEY123456"></span></div>')
    :new Response(bytes); };
  const store=new MemoryStore([{slug:'open-1',name:'Open 1',kind:'open',data:{sessions:[],circuitRounds:[]}}]);
  const app=createApp(store,{fetchFn});
  const login=await http(app,'POST','/api/admin/login',{username:'admin',password:'secret'}), H={Authorization:`Bearer ${login.body.token}`};
  const preview=await http(app,'POST','/api/admin/events/open-1/circuits/drive/preview',{folderUrl:'https://drive.google.com/drive/folders/ABC1234567?resourcekey=FOLDERKEY123456'},H);
  assert.equal(preview.status,200); assert.equal(preview.body.id,'M1'); assert.equal(preview.body.layout.points.length,1);
  assert.match(requested[0],/resourcekey=FOLDERKEY123456/); assert.match(requested[1],/resourcekey=FILEKEY123456/);
  const missing=await http(app,'POST','/api/admin/events/wrong-event/circuits/drive/preview',{folderUrl:'https://drive.google.com/drive/folders/ABC1234567'},H);
  assert.equal(missing.status,404); assert.equal(missing.body.error,'Événement introuvable');
  const deniedApp=createApp(store,{fetchFn:async()=>new Response('',{status:401})});
  const denied=await http(deniedApp,'POST','/api/admin/events/open-1/circuits/drive/preview',{folderUrl:'https://drive.google.com/drive/folders/ABC1234567'},H);
  assert.equal(denied.status,400); assert.match(denied.body.error,/Tous les utilisateurs disposant du lien/);
  const js=fs.readFileSync(path.join(__dirname,'..','frontend','public','site.js'),'utf8');
  assert.match(js,/const eventSlug=currentSlug, preview=/);
  assert.match(js,/adminApi\(`\/api\/admin\/events\/\$\{encodeURIComponent\(eventSlug\)\}\/circuits\/drive\/preview`/);
  assert.match(js,/Aperçu Drive impossible : \$\{e\.message\}/);
});
test('.gitignore: aucun motif lib/ non ancré (tools/lib ne doit pas être avalé)',()=>{
  const lines=fs.readFileSync(path.join(__dirname,'..','.gitignore'),'utf8').split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));
  assert.ok(!lines.includes('lib/')&&!lines.includes('lib'), lines.join(','));
  assert.ok(fs.existsSync(path.join(__dirname,'..','tools','lib','fastLane.js')));
});
test('persistance: une base vide reçoit la démo, une base existante reste intacte',async()=>{
  const empty=new MemoryStore([]);
  assert.equal(await seedIfEmpty(empty),true);
  assert.equal((await empty.listEvents())[0].slug,'championnat-exemple');
  assert.equal(await seedIfEmpty(empty),false);
  const existing=new MemoryStore([{slug:'reel',name:'Championnat réel',kind:'open',data:{sessions:[]}}]);
  assert.equal(await seedIfEmpty(existing),false);
  assert.deepEqual((await existing.listEvents()).map(e=>e.slug),['reel']);
});
test('thème vintage premium: appliqué au SSR et à l’interface applicative',async()=>{
  const app=createFrontendApp({fetchJson:async url=>url.endsWith('/api/stats')
    ?{events:0,races:0,drivers:0}:[]});
  const home=await http(app,'GET','/');
  assert.match(home.body,/href="\/theme\.css"/);
  assert.match(home.body,/class="hero"/);
  assert.match(home.body,/class="stats-grid"/);
  assert.match(home.body,/class="nav-events" href="\/#championnats">Événements<\/a>/);
  assert.match(home.body,/href="\/index.html">Administration<\/a>/);
  assert.match(home.body,/La piste,/);
  const css=fs.readFileSync(path.join(__dirname,'..','frontend','public','theme.css'),'utf8');
  assert.match(css,/--ink: #102a32/);
  assert.match(css,/--page: #e9e0cb/);
  const html=fs.readFileSync(path.join(__dirname,'..','frontend','public','index.html'),'utf8');
  assert.match(html,/class="app-hero"/);
  assert.doesNotMatch(html,/id="tabs"/); assert.doesNotMatch(html,/data-panel="standings"/);
  assert.match(html,/Administration\. <em>Vos événements\./);
  assert.match(html,/class="nav-events" href="\/#championnats">Événements<\/a>/);
  assert.match(css,/\.site-nav \.nav-events \{ display: inline/);
  assert.doesNotMatch(html,/color-scheme:dark/);
});
test('administration mobile: formulaires tactiles et Commission en cartes',()=>{
  const css=fs.readFileSync(path.join(__dirname,'..','frontend','public','theme.css'),'utf8');
  assert.match(css,/@media \(max-width: 580px\)/);
  assert.match(css,/#login \{ display: grid; grid-template-columns: 1fr/);
  assert.match(css,/\[data-pending-card\] tr\[data-pending-result\]/);
  assert.match(css,/content: attr\(data-label\)/);
  assert.match(css,/font-size: 16px/);
  const js=fs.readFileSync(path.join(__dirname,'..','frontend','public','site.js'),'utf8');
  assert.match(js,/data-label="Temps total \(s\)"/);
  assert.match(js,/aria-label="Pénalité du pilote/);
  const html=fs.readFileSync(path.join(__dirname,'..','frontend','public','index.html'),'utf8');
  assert.match(html,/<label>Utilisateur<input/); assert.match(html,/<label>Mot de passe<input/);
});
test('Cup: type valide et section entre championnats et opens',async()=>{
  assert.equal(validateEvent({slug:'cup-test',name:'Cup test',kind:'cup'}).kind,'cup');
  const app=createFrontendApp({fetchJson:async url=>url.endsWith('/api/stats')?{events:1,races:0,drivers:0}:[{slug:'cup-test',name:'Cup test',kind:'cup'}]});
  const home=await http(app,'GET','/');
  const championship=home.body.indexOf('Championnats en cours'), cup=home.body.indexOf('>Cups<'), open=home.body.indexOf('>Opens<');
  assert.ok(championship>=0&&cup>championship&&open>cup);
  assert.match(home.body,/href="\/evenements\/cup-test"/);
  const js=fs.readFileSync(path.join(__dirname,'..','frontend','public','site.js'),'utf8');
  assert.match(js,/id="ah-kind"><option value="championship">Championnat<\/option><option value="cup">Cup — mini-championnat/);
});
async function http(app,method,url,body,headers={}){
  const srv=app.listen(0); await new Promise(r=>srv.once('listening',r));
  try{ const res=await fetch(`http://127.0.0.1:${srv.address().port}${url}`,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
    return {status:res.status, body:res.headers.get('content-type')?.includes('json')?await res.json():await res.text(), headers:res.headers}; }
  finally{ srv.close(); }
}
test('API: health, événements, admin protégé, import anonymisé',async()=>{
  process.env.ADMIN_USERNAME='admin'; process.env.ADMIN_PASSWORD='secret';
  const app=createApp(new MemoryStore([]));
  assert.equal((await http(app,'GET','/api/health')).status,200);
  assert.equal((await http(app,'POST','/api/admin/events',{slug:'x',kind:'open',name:'X'})).status,401);
  const login=await http(app,'POST','/api/admin/login',{username:'admin',password:'secret'});
  assert.equal(login.status,200);
  const created=await http(app,'POST','/api/admin/events',{slug:'open-1',kind:'open',name:'Open Alfa Romeo',data:{eventInfo:{plateau:'Alfa Romeo GTA'}}}, {Authorization:`Bearer ${login.body.token}`});
  assert.equal(created.status,201);
  const imp=await http(app,'POST','/api/admin/events/open-1/import',{payloads:[{Date:'2026-02-01T20:00:00',Type:'RACE',Track:'Monza',Results:[{DriverGuid:GUID,DriverName:'Bob',Position:1}]}]}, {Authorization:`Bearer ${login.body.token}`});
  assert.equal(imp.body.added,1);
  const got=await http(app,'GET','/api/events/open-1'); assert.doesNotMatch(JSON.stringify(got.body),/7656119/);
  assert.equal(got.body.data.sessions.length,1); // les Opens sont publiés directement, sans Commission
  assert.equal(got.body.data.circuitRounds[0].label,'Monza');
  assert.equal('pendingSessions' in got.body.data,false);
});
test('Commission: import privé, correction, publication puis calcul du classement',async()=>{
  process.env.ADMIN_USERNAME='admin'; process.env.ADMIN_PASSWORD='secret';
  const store=new MemoryStore([{slug:'commission',name:'Commission',kind:'championship',
    points_config:{scale:[25,18],polePoints:0,coefficient:1,jokers:0,minDistancePercent:0},data:{sessions:[],pendingSessions:[],penMap:{}}}]);
  const app=createApp(store), login=await http(app,'POST','/api/admin/login',{username:'admin',password:'secret'});
  const H={Authorization:`Bearer ${login.body.token}`};
  const race={Date:'2026-04-01T20:00:00',Type:'RACE',Track:'Monza',Results:[
    {DriverGuid:GUID,DriverName:'Alice',Position:1,TotalTime:100000,BestLap:50000},
    {DriverGuid:'76561198000000002',DriverName:'Bob',Position:2,TotalTime:105000,BestLap:51000}]};
  const qualify={Date:'2026-04-01T19:00:00',Type:'QUALIFY',Track:'Monza',Results:race.Results};
  assert.equal((await http(app,'GET','/api/admin/events/commission/commission')).status,401);
  const imported=await http(app,'POST','/api/admin/events/commission/import',{payloads:[race,qualify]},H);
  assert.deepEqual(imported.body,{added:2,duplicates:0,published:false});
  assert.equal((await http(app,'GET','/api/events/commission/standings')).body.length,0);
  assert.equal((await http(app,'GET','/api/stats')).body.races,0);
  const drafts=await http(app,'GET','/api/admin/events/commission/commission',null,H);
  assert.equal(drafts.body.pendingSessions.length,2);
  const corrected=structuredClone(drafts.body.pendingSessions[0]);
  corrected.results[0].driverName='Alice corrigée'; corrected.results[0].penaltySeconds=10;
  assert.equal((await http(app,'PUT','/api/admin/events/commission/commission/0',{session:corrected},H)).status,200);
  assert.equal((await http(app,'GET','/api/events/commission')).body.data.sessions.length,0);
  const published=await http(app,'POST','/api/admin/events/commission/commission/0/publish',{},H);
  assert.equal(published.status,200); assert.equal(published.body.published.results[0].driverName,'Bob');
  const publicEvent=await http(app,'GET','/api/events/commission');
  assert.equal(publicEvent.body.data.sessions.length,1); assert.equal(publicEvent.body.data.sessions[0].results[1].driverName,'Alice corrigée');
  assert.equal('pendingSessions' in publicEvent.body.data,false);
  const standings=await http(app,'GET','/api/events/commission/standings');
  assert.equal(standings.body[0].driverName,'Bob'); assert.equal(standings.body[0].total,25);
  assert.equal((await http(app,'GET','/api/stats')).body.races,1);
  const duplicate=await http(app,'POST','/api/admin/events/commission/import',{payloads:[race,qualify]},H);
  assert.deepEqual(duplicate.body,{added:0,duplicates:2,published:false});
  assert.equal((await http(app,'DELETE','/api/admin/events/commission/commission/0',null,H)).status,200);
  assert.equal((await http(app,'GET','/api/admin/events/commission/commission',null,H)).body.pendingSessions.length,0);
});
test('SSR sans JS: accueil + événement, canonical, 503+Retry-After si backend KO',async()=>{
  const ok=createFrontendApp({fetchJson:async(url)=>url.endsWith('/api/stats')?{events:1,races:2,drivers:3}:url.includes('/api/events/')
    ?{slug:'open-1',name:'Open Alfa Romeo',kind:'open',data:{eventInfo:{description:'Alfa uniquement'},customCalendar:{M1:'2026-03-01'},circuitRounds:[]}}
    :[{slug:'open-1',name:'Open Alfa Romeo',kind:'open'}], siteUrl:'https://gdsp.example'});
  const home=await http(ok,'GET','/'); assert.match(home.body,/Championnats en cours/); assert.match(home.body,/rel="canonical"/);
  const ev=await http(ok,'GET','/evenements/open-1'); assert.match(ev.body,/Alfa uniquement/); assert.doesNotMatch(ev.body,/Lola T290/); // no cross-event label leakage
  assert.match(ev.body,/data-panel="infos"/); assert.match(ev.body,/data-panel="standings"/); // containers required by site.js
  assert.match((await http(ok,'GET','/robots.txt')).body,/Sitemap:/);
  assert.match((await http(ok,'GET','/sitemap.xml')).body,/evenements\/open-1/);
  const down=createFrontendApp({fetchJson:async()=>{throw new Error('down');}});
  const ko=await http(down,'GET','/'); assert.equal(ko.status,503); assert.equal(ko.headers.get('retry-after'),'30'); assert.match(ko.body,/temporairement indisponible/);
});

test('pénalité Commission indexée par date de course: le classement général est recalculé',()=>{
  const ev={slug:'p',kind:'open',points_config:{scale:[25,18],polePoints:0,coefficient:1,jokers:0,minDistancePercent:0},
    data:{sessions:[{type:'RACE',date:'2026-03-01',track:'Monza',results:[
      {driverId:'a',driverName:'A',position:1,totalTimeSeconds:100},{driverId:'b',driverName:'B',position:2,totalTimeSeconds:105}]}],
      penMap:{'2026-03-01':[{driverId:'a',seconds:10}]},circuitRounds:[]}};
  const st=computeStandings(ev);
  assert.equal(st[0].driverId,'b'); // A pénalisé de 10s tombe derrière B
});

test('global: un pilote exclu par l\u2019administration disparaît du classement Discord',()=>{
  const race=i=>({type:'RACE',date:'2026-01-0'+i,track:'t'+i,results:[
    {driverId:'a',driverName:'A',position:1,totalTimeSeconds:100,bestLapSeconds:90},
    {driverId:'b',driverName:'B',position:2,totalTimeSeconds:110,bestLapSeconds:95}],laps:[],events:[]});
  const ev={slug:'g2',data:{sessions:[1,2,3,4,5].map(race),penMap:{}}};
  const all=computeGlobalRatings([ev],{now:new Date('2026-01-10')});
  assert.ok(all.some(r=>r.driverId==='a'));
  const filtered=computeGlobalRatings([ev],{now:new Date('2026-01-10'),excludedDriverIds:['a']});
  assert.ok(!filtered.some(r=>r.driverId==='a')); assert.ok(filtered.some(r=>r.driverId==='b'));
});

test('API admin: exclusions globales, serveurs AH, noms pilotes, suppression de manche',async()=>{
  process.env.ADMIN_USERNAME='admin'; process.env.ADMIN_PASSWORD='secret';
  const store=new MemoryStore([{slug:'ev1',name:'Ev1',kind:'open',
    data:{sessions:[],penMap:{},manualDrivers:{},customCalendar:{},eventInfo:{},posterImage:null,galleryImages:[],
      circuitRounds:[{id:'M1',label:'Manche 1'}],serversAH:[]}}]);
  const app=createApp(store);
  const login=await http(app,'POST','/api/admin/login',{username:'admin',password:'secret'});
  const H={Authorization:`Bearer ${login.body.token}`};
  assert.equal((await http(app,'PUT','/api/admin/global/exclusions',{globalExclusions:['pilote-x']},H)).status,200);
  assert.deepEqual((await http(app,'GET','/api/admin/global/exclusions',null,H)).body.globalExclusions,['pilote-x']);
  assert.equal((await http(app,'PUT','/api/admin/global/exclusions',{globalExclusions:['pilote-x']})).status,401);
  const srv=await http(app,'PUT','/api/admin/events/ev1/servers',{servers:[{name:'AH1',url:'https://ah.example/results'}]},H);
  assert.equal(srv.body.serversAH[0].name,'AH1');
  const drv=await http(app,'PUT','/api/admin/events/ev1/drivers',{manualDrivers:{'pilote-a':'Nouveau Nom'}},H);
  assert.equal(drv.body.manualDrivers['pilote-a'],'Nouveau Nom');
  assert.equal((await http(app,'DELETE','/api/admin/events/ev1/circuits/M1',null,H)).status,204);
  assert.equal((await http(app,'GET','/api/events/ev1')).body.data.circuitRounds.length,0);
});

test('proxy frontend: un POST /api/* transmet le corps brut au backend (régression)',async()=>{
  process.env.ADMIN_USERNAME='admin'; process.env.ADMIN_PASSWORD='secret';
  const backend=createApp(new MemoryStore([]));
  const bsrv=backend.listen(0); await new Promise(r=>bsrv.once('listening',r));
  process.env.BACKEND_URL=`http://127.0.0.1:${bsrv.address().port}`;
  try{
    const front=createFrontendApp({fetchJson:async()=>{throw new Error('unused');}});
    const login=await http(front,'POST','/api/admin/login',{username:'admin',password:'secret'});
    assert.equal(login.status,200); assert.ok(login.body.token);
    const ko=await http(front,'POST','/api/admin/login',{username:'admin',password:'faux'});
    assert.equal(ko.status,401);
  } finally { bsrv.close(); delete process.env.BACKEND_URL; }
});

test('service unifié: pages, statiques et API sans proxy ni BACKEND_URL externe',async()=>{
  const previous=process.env.BACKEND_URL;
  const store=new MemoryStore([{slug:'ev',name:'Événement unifié',kind:'open',data:{sessions:[],pendingSessions:[],penMap:{}}}]);
  const server=createUnifiedApp(store).listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  process.env.BACKEND_URL=`http://127.0.0.1:${server.address().port}`;
  const base=process.env.BACKEND_URL;
  try{
    const health=await fetch(`${base}/api/health`); assert.equal(health.status,200);
    const home=await fetch(`${base}/`); assert.equal(home.status,200); assert.match(await home.text(),/Événement unifié/);
    const css=await fetch(`${base}/theme.css`); assert.equal(css.status,200); assert.match(await css.text(),/--ink: #102a32/);
    const missing=await fetch(`${base}/api/route-inconnue`); assert.equal(missing.status,404); // no self-proxy loop
    const app=await fetch(`${base}/index.html`); assert.equal(app.status,200); assert.match(await app.text(),/Administration/);
  }finally{
    await new Promise(r=>server.close(r));
    if(previous==null) delete process.env.BACKEND_URL; else process.env.BACKEND_URL=previous;
  }
});

test('championnats AH: parsing de la liste et extraction RACE/QUALIFY de l’export',()=>{
  const html=`<table><tr><td><a href="/championship/abc-123">Open GDSP</a></td><td>91%</td><td>7</td><td>1</td><td>30</td><td><a href="/championship/abc-123">View</a></td></tr>
    <tr><td><a href="/championship/def-456">Open terminé</a></td><td>100%</td><td>1</td><td>1</td><td>12</td></tr></table>`;
  const list=parseChampionshipsHtml(html,'https://fr2.assettohosting.com:50648/championships');
  assert.equal(list.length,2); assert.equal(list[0].name,'Open GDSP'); assert.equal(list[0].eventCount,7);
  assert.equal(list[0].status,'active'); assert.equal(list[1].status,'completed');
  assert.equal(championshipExportUrl(list[0].url).exportUrl,'https://fr2.assettohosting.com:50648/championship/abc-123/export');
  const raw={ID:'abc-123',Name:'Open GDSP',Classes:[{Entrants:{CAR_0:{GUID:GUID}}}],Events:[{Sessions:{Qualifying:{Type:'QUALIFY',Date:'2026-01-01',Result:[]},Race:{Type:'RACE',Date:'2026-01-02',Result:[]},Practice:{Type:'PRACTICE',Date:'2026-01-01',Result:[]}}}]};
  const sessions=extractChampionshipSessions(raw);
  assert.equal(sessions.length,2); assert.ok(sessions.every(s=>s.ChampionshipID==='abc-123'));
  assert.ok(sessions.every(s=>s.EventName==='Open GDSP'));
});

test('API championnat AH: liste protégée, import anonymisé vers Commission uniquement',async()=>{
  process.env.ADMIN_USERNAME='admin'; process.env.ADMIN_PASSWORD='secret';
  const store=new MemoryStore([{slug:'ah',name:'Événement AH',kind:'championship',data:{sessions:[],pendingSessions:[],penMap:{}}}]);
  const raw={ID:'abc-123',Name:'Open GDSP',Updated:'2026-11-01',Stats:{Progress:91,NumEvents:7},Classes:[{Entrants:{CAR_0:{GUID:GUID}}}],Events:[{Sessions:[
    {Type:'QUALIFY',Date:'2026-01-01',Track:'Monza',Result:[{DriverGuid:GUID,DriverName:'Alice',Position:1}]},
    {Type:'RACE',Date:'2026-01-02',Track:'Monza',Result:[{DriverGuid:GUID,DriverName:'Alice',Position:1,TotalTime:100000}]},
    {Type:'PRACTICE',Date:'2026-01-01',Track:'Monza',Result:[]}]}]};
  const app=createApp(store,{fetchText:async()=>'<tr><td><a href="/championship/abc-123">Open GDSP</a></td><td>91%</td><td>7</td><td>1</td><td>30</td></tr>',fetchJson:async()=>raw});
  assert.equal((await http(app,'GET','/api/admin/assettohosting/championships')).status,401);
  const login=await http(app,'POST','/api/admin/login',{username:'admin',password:'secret'}), H={Authorization:`Bearer ${login.body.token}`};
  const list=await http(app,'GET','/api/admin/assettohosting/championships?url=https%3A%2F%2Ffr2.assettohosting.com%3A50648%2Fchampionships',null,H);
  assert.equal(list.status,200); assert.equal(list.body[0].name,'Open GDSP');
  const imported=await http(app,'POST','/api/admin/events/ah/import/championship',{championshipUrl:list.body[0].url},H);
  assert.equal(imported.status,200); assert.equal(imported.body.scanned,2); assert.equal(imported.body.added,2);
  const saved=await store.getEvent('ah'); assert.equal(saved.data.pendingSessions.length,2); assert.equal(saved.data.sessions.length,0);
  assert.equal(saved.data.championshipAH.name,'Open GDSP'); assert.doesNotMatch(JSON.stringify(saved),/7656119/);
  const publicEvent=await http(app,'GET','/api/events/ah'); assert.equal('pendingSessions' in publicEvent.body.data,false);
});

test('import autonome: événement créé, brouillon privé, archivage et réouverture',async()=>{
  process.env.ADMIN_USERNAME='admin'; process.env.ADMIN_PASSWORD='secret';
  const store=new MemoryStore([{slug:'mini-cup',name:'Existant',kind:'cup',data:{sessions:[]}}]);
  const raw={ID:'cup-id',Name:'Mini Cup Été',Events:[{Sessions:{Race:{Type:'RACE',Date:'2026-01-02',Track:'Monza',Result:[{DriverGuid:GUID,DriverName:'Alice',Position:1}]}}}]};
  const app=createApp(store,{fetchJson:async()=>raw});
  const login=await http(app,'POST','/api/admin/login',{username:'admin',password:'secret'}), H={Authorization:`Bearer ${login.body.token}`};
  const created=await http(app,'POST','/api/admin/assettohosting/championships/import',{championshipUrl:'https://fr2.assettohosting.com:50648/championship/cup-id',kind:'cup'},H);
  assert.equal(created.status,201); assert.equal(created.body.event.slug,'mini-cup-ete'); assert.equal(created.body.event.kind,'cup');
  const saved=await store.getEvent('mini-cup-ete'); assert.equal(saved.data.sessions.length,0); assert.equal(saved.data.pendingSessions.length,1);
  const second=await http(app,'POST','/api/admin/assettohosting/championships/import',{championshipUrl:'https://fr2.assettohosting.com:50648/championship/cup-id',kind:'cup'},H);
  assert.equal(second.body.event.slug,'mini-cup-ete-2');
  await http(app,'PUT','/api/admin/events/mini-cup-ete/kind',{kind:'archive'},H);
  assert.equal((await store.getEvent('mini-cup-ete')).data.activeKind,'cup');
  const reopened=await http(app,'PUT','/api/admin/events/mini-cup-ete/kind',{reopen:true},H);
  assert.equal(reopened.body.kind,'cup');
  assert.equal((await http(app,'DELETE','/api/admin/events/mini-cup-ete-2',null,H)).status,204);
  assert.equal(await store.getEvent('mini-cup-ete-2'),null);
  const js=fs.readFileSync(path.join(__dirname,'..','frontend','public','site.js'),'utf8');
  assert.match(js,/Créer l’événement et importer/); assert.match(js,/data-archive=/); assert.match(js,/data-reopen=/); assert.match(js,/data-delete=/);
});
test('manches chronologiques, barème importé et médias protégés',async()=>{
  process.env.ADMIN_USERNAME='admin'; process.env.ADMIN_PASSWORD='secret';
  const raw={ID:'rounds',Name:'Open circuits',Classes:[{Points:[30,24,20]}],Events:[{Sessions:[
    {Type:'RACE',Date:'2026-02-02T21:00:00',Track:'ks_brands_hatch',Result:[{DriverGuid:GUID,DriverName:'Alice',Position:1}]},
    {Type:'QUALIFY',Date:'2026-02-02T20:00:00',Track:'ks_brands_hatch',Result:[]},
    {Type:'RACE',Date:'2026-01-01T21:00:00',Track:'magny-cours',Result:[{DriverGuid:GUID,DriverName:'Alice',Position:1}]}]}]};
  const store=new MemoryStore([]), app=createApp(store,{fetchJson:async()=>raw});
  const login=await http(app,'POST','/api/admin/login',{username:'admin',password:'secret'}), H={Authorization:`Bearer ${login.body.token}`};
  const created=await http(app,'POST','/api/admin/assettohosting/championships/import',{championshipUrl:'https://fr2.assettohosting.com:50648/championship/rounds',kind:'open'},H);
  assert.equal(created.body.published,true);
  const saved=await store.getEvent('open-circuits');
  assert.deepEqual(saved.points_config.scale,[30,24,20]);
  assert.deepEqual(saved.data.sessions.filter(s=>s.type==='RACE').map(s=>s.label),['Manche 2','Manche 1']); // l'ordre source est conservé, les numéros suivent les dates
  assert.equal(saved.data.sessions.find(s=>s.type==='QUALIFY').label,'Manche 2');
  assert.equal(saved.data.circuitRounds[0].track.name,'Magny Cours');
  const image='data:image/png;base64,iVBORw0KGgo=';
  assert.equal((await http(app,'PUT','/api/admin/events/open-circuits/media',{posterImage:image,galleryImages:[image]},H)).status,200);
  assert.equal((await store.getEvent('open-circuits')).data.galleryImages.length,1);
  assert.equal((await http(app,'PUT','/api/admin/events/open-circuits/media',{posterImage:'https://externe.invalid/a.jpg'},H)).status,400);
  const js=fs.readFileSync(path.join(__dirname,'..','frontend','public','site.js'),'utf8');
  assert.match(js,/displayLabel=`Manche/); assert.match(js,/cleanTrack\(r.track\)/); assert.match(js,/event.data.circuitRounds\?\.length/);
  const frontend=fs.readFileSync(path.join(__dirname,'..','frontend','app.js'),'utf8');
  assert.match(frontend,/Barème de points/); assert.match(frontend,/event-gallery/); assert.match(frontend,/event-poster/);
});
test('barème AssettoHosting réel: Places, pole, meilleur tour et deuxième course double',()=>{
  const {extractPointsConfig}=require('../backend/lib/ahChampionships');
  const cfg=extractPointsConfig({Classes:[{Points:{Places:[20,15,10],BestLap:1,PolePosition:2,MostLapsLed:3,SecondRaceMultiplier:2}}]});
  assert.deepEqual(cfg.scale,[20,15,10]); assert.equal(cfg.polePoints,2); assert.equal(cfg.bestLapPoints,1); assert.equal(cfg.mostLapsLedPoints,3); assert.equal(cfg.secondRaceMultiplier,2);
  const results=[{driverId:'a',driverName:'A',position:1,bestLapSeconds:50,distancePercent:100},{driverId:'b',driverName:'B',position:2,bestLapSeconds:51,distancePercent:100}];
  const sessions=[{type:'QUALIFY',track:'Monza',date:'2026-01-01T18:00:00',results:[{driverId:'a',bestLapSeconds:49}]},
    {type:'RACE',track:'Monza',date:'2026-01-01T20:00:00',results},{type:'RACE',track:'Monza',date:'2026-01-01T21:00:00',results}];
  const standings=computeStandings({points_config:cfg,data:{sessions,penMap:{}}});
  assert.deepEqual(standings.find(d=>d.driverId==='a').roundPoints,[23,46]); // (20+2+1), puis (20+2+1)×2
  const nested=extractPointsConfig({Points:{'class-id':{Places:[12,8],PolePosition:1}}}); assert.deepEqual(nested.scale,[12,8]);
});
test('manche journalière multi-courses et barème pole/double',async()=>{
  const {calendar}=require('../backend/lib/eventPresentation');
  const {extractPointsConfig}=require('../backend/lib/ahChampionships');
  const event={data:{sessions:[
    {type:'QUALIFY',date:'2026-02-01T18:00:00',track:'monza'},
    {type:'RACE',date:'2026-02-01T20:00:00',track:'monza',results:[{driverName:'Alice',position:1}]},
    {type:'RACE',date:'2026-02-01T21:00:00',track:'monza',results:[{driverName:'Bob',position:1}]},
    {type:'RACE',date:'2026-02-02T20:00:00',track:'spa',results:[]}]}};
  const cal=calendar(event); assert.equal(cal.length,2); assert.equal(cal[0].raceCount,2); assert.equal(cal[0].label,'Manche 1'); assert.deepEqual(cal[0].winners.map(w=>w.driverName),['Alice','Bob']);
  const points=extractPointsConfig({Classes:[{PointsConfig:{Points:{1:30,2:24},PolePositionPoints:2,DoublePoints:true}}]});
  assert.deepEqual(points.scale,[30,24]); assert.equal(points.polePoints,2); assert.equal(points.coefficient,2);
  const app=createFrontendApp({fetchJson:async url=>url.endsWith('/api/stats')?{}:{slug:'e',name:'E',points_config:points,data:{sessions:[],eventInfo:{}}}});
  const page=await http(app,'GET','/evenements/e'); assert.match(page.body,/Pole <strong>\+2<\/strong>/); assert.match(page.body,/manche comptant double/);
});
test('présentation enrichie: calendrier, nom dédupliqué, duels et statistiques',async()=>{
  const {cleanEventName,eventInsights}=require('../backend/lib/eventPresentation');
  assert.equal(cleanEventName('Open R8 / Open R8 Open R8'),'Open R8');
  const store=new MemoryStore([{slug:'stats',name:'Open / Open',kind:'open',data:{sessions:[
    {type:'QUALIFY',date:'2026-01-01T19:00:00',results:[{driverId:'a',driverName:'Alice',position:2},{driverId:'b',driverName:'Bob',position:1}]},
    {type:'RACE',date:'2026-01-01T20:00:00',track:'ks_clermont1965',results:[{driverId:'a',driverName:'Alice',position:1,totalTimeSeconds:100,bestLapSeconds:50,laps:2},{driverId:'b',driverName:'Bob',position:2,totalTimeSeconds:103,bestLapSeconds:51,laps:2}],events:[],laps:[{driverId:'a',timeSeconds:50,cuts:0},{driverId:'a',timeSeconds:50,cuts:0}]}],pendingSessions:[],penMap:{}}}]);
  const app=createApp(store), pub=await http(app,'GET','/api/events/stats');
  assert.equal(pub.body.name,'Open'); assert.equal(pub.body.data.autoCalendar[0].label,'Manche 1'); assert.equal(pub.body.data.autoCalendar[0].winners[0].driverName,'Alice');
  const insights=(await http(app,'GET','/api/events/stats/insights')).body;
  assert.equal(insights.summary.participants,2); assert.equal(insights.summary.totalLaps,4); assert.equal(insights.races[0].results[0].gained,1);
  assert.equal(insights.drivers.find(d=>d.driverId==='a').wins,1); assert.equal(insights.tracks[0].track,'Clermont 1965');
  const js=fs.readFileSync(path.join(__dirname,'..','frontend','public','site.js'),'utf8'); assert.match(js,/Télécharger le visuel Discord/); assert.match(js,/Duels entre pilotes/);
});
test('format RÉEL AssettoHosting: Result singulier, temps en ms, distance via NumLaps, collisions imbriquées',()=>{
  const raw={Version:7, Type:'RACE', Date:'2026-11-04T22:42:00+01:00', TrackName:'6thgpmexico67', TrackConfig:'gp',
    EventName:'Race Weekend: Manche #5 - Mexico - Lola T290', ChampionshipID:'ch-1',
    Result:[
      {DriverGuid:GUID, DriverName:'Alice', TotalTime:1609007, BestLap:112535, NumLaps:14, GridPosition:3, HasPenalty:false, PenaltyTime:0, Disqualified:false},
      {DriverGuid:'76561198000000002', DriverName:'Bob', TotalTime:1650000, BestLap:115000, NumLaps:7, GridPosition:1}],
    Laps:[{DriverGuid:GUID, DriverName:'Alice', LapTime:122734, Cuts:1, Sectors:[34763,63001,24970]}],
    Events:[{Type:'COLLISION_WITH_CAR', ImpactSpeed:11.8, Driver:{Guid:GUID, Name:'Alice'}, OtherDriver:{Guid:'76561198000000002', Name:'Bob'}}]};
  const s=normalizeSession(raw);
  assert.equal(s.results[0].position,1); // l'ordre du tableau Result EST le classement
  assert.equal(s.results[0].totalTimeSeconds,1609.007);
  assert.equal(s.results[0].bestLapSeconds,112.535);
  assert.equal(s.results[1].distancePercent,50); // 7 tours sur 14 du leader
  assert.equal(s.laps[0].timeSeconds,122.734); // LapTime est TOUJOURS en ms (122734, pas 122734 s !)
  assert.equal(s.laps[0].number,1);
  assert.equal(s.events[0].driverId,pseudonymize(GUID)); // pilote imbriqué {Driver:{Guid}} anonymisé
  assert.doesNotMatch(JSON.stringify(s),/7656119/);
});

test('scan AssettoHosting: index HTML paginé, PRACTICE jamais téléchargé, doublons gérés par l\u2019import',async()=>{
  const {scanServer, parseResultsIndexHtml, defaultServers, DEFAULT_AH_SERVERS}=require('../backend/lib/ahServers');
  assert.equal(parseResultsIndexHtml('<a href="/results/download/2026_1_1_20_0_RACE.json">x</a>')[0].type,'RACE');
  assert.deepEqual(DEFAULT_AH_SERVERS.map(s=>s.url),['https://fr2.assettohosting.com:50648/results','https://fr5.assettohosting.com:50145/results']);
  process.env.AH_SERVER_URLS='https://s1.example/results,https://s2.example/results,https://s3.example/results';
  assert.equal(defaultServers().length,3); // un 3e serveur = de la configuration, pas du code
  delete process.env.AH_SERVER_URLS;
  const downloaded=[];
  const raceFile='2026_11_4_22_42_RACE.json';
  const fetchText=async url=> url.includes('Type%3ARACE')
    ? `<a href="/results/download/${raceFile}">r</a><a href="/results/download/2026_11_4_20_0_PRACTICE.json">p</a>` : '<html></html>';
  const fetchJson=async url=>{ downloaded.push(url); return {Type:'RACE', Date:'2026-11-04T22:42:00+01:00', Result:[]}; };
  const payloads=await scanServer({name:'test', url:'https://ah.example/results'}, {fetchText, fetchJson});
  assert.equal(payloads.length,1);
  assert.ok(downloaded[0].endsWith(raceFile));
  assert.ok(!downloaded.some(u=>u.includes('PRACTICE')));
});
