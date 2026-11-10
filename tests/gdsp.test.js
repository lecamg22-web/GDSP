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
const {parseDriveFolderHtml,pickCircuitFiles,extractFolderId}=require('../tools/lib/drive');
const {buildCircuitRound}=require('../backend/lib/circuit');
const {createApp}=require('../backend/app');
const {MemoryStore,seedIfEmpty}=require('../backend/lib/store');
const {createFrontendApp}=require('../frontend/app');

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
test('drive: id dossier, parsing dossier public, fast_lane obligatoire',()=>{
  assert.equal(extractFolderId('https://drive.google.com/drive/folders/ABC1234567_-x'),'ABC1234567_-x');
  const files=parseDriveFolderHtml('<div data-id="FILEID123456"><span class="flip-entry-title">fast_lane.ai</span></div>');
  assert.equal(files[0].name,'fast_lane.ai'); assert.equal(pickCircuitFiles(files).fastLane.id,'FILEID123456');
  assert.throws(()=>pickCircuitFiles([{id:'x',name:'surfaces.ini'}]),/fast_lane\.ai/);
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
test('thème vintage: appliqué au SSR et à l’interface applicative',async()=>{
  const app=createFrontendApp({fetchJson:async url=>url.endsWith('/api/stats')
    ?{events:0,races:0,drivers:0}:[]});
  const home=await http(app,'GET','/');
  assert.match(home.body,/--ink:#102a32/);
  assert.match(home.body,/background:#e9e0cb/);
  assert.match(home.body,/La piste, entre gentlemen/);
  const html=fs.readFileSync(path.join(__dirname,'..','frontend','public','index.html'),'utf8');
  assert.match(html,/--gold:#cd9a42/);
  assert.doesNotMatch(html,/color-scheme:dark/);
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
});
test('SSR sans JS: accueil + événement, canonical, 503+Retry-After si backend KO',async()=>{
  const ok=createFrontendApp({fetchJson:async(url)=>url.endsWith('/api/stats')?{events:1,races:2,drivers:3}:url.includes('/api/events/')
    ?{slug:'open-1',name:'Open Alfa Romeo',kind:'open',data:{eventInfo:{description:'Alfa uniquement'},customCalendar:{M1:'2026-03-01'},circuitRounds:[]}}
    :[{slug:'open-1',name:'Open Alfa Romeo',kind:'open'}], siteUrl:'https://gdsp.example'});
  const home=await http(ok,'GET','/'); assert.match(home.body,/Championnats en cours/); assert.match(home.body,/rel="canonical"/);
  const ev=await http(ok,'GET','/evenements/open-1'); assert.match(ev.body,/Alfa uniquement/); assert.doesNotMatch(ev.body,/Lola T290/); // no cross-event label leakage
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
