'use strict';
const {pseudonymize} = require('./anonymize');
function sessionKey(s){ return `${String(s.date||'').slice(0,19)}|${String(s.type||'').toUpperCase()}`; }
function isIgnoredSession(raw){
  const type=String(raw.Type||raw.type||raw.SessionType||'').toUpperCase();
  const name=String(raw.SessionName||raw.name||raw.Track||'').toLowerCase();
  return type.includes('PRACTICE') || /\btest\b|essai/.test(name);
}
const ms=v=>(v==null||v===0)?null:Number(v)/1000; // Assetto Corsa times are ALWAYS milliseconds (LapTime 122734 = 122,734 s)
function normalizeLap(l, number){ return { number:number??l.LapNo??l.number??null,
  driverId:(l.DriverGuid||l.DriverGUID)?pseudonymize(l.DriverGuid||l.DriverGUID):(l.driverId||null),
  driverName:l.DriverName||l.driverName||'À confirmer', timeSeconds:l.timeSeconds!=null?Number(l.timeSeconds):ms(l.LapTime),
  cuts:Number(l.Cuts??l.cuts??0), sectorTimes:(l.Sectors||l.sectorTimes||[]).map(s=>Number(s)/1000) }; }
function penaltySeconds(r){ const v=Number(r.PenaltyTime??r.penaltySeconds??0); if(!v) return Number(r.penaltySeconds)||0;
  return v>=10000? v/1000 : v; } // PenaltyTime: seconds in AC exports, defensively accept ms
/** Normalize one AssettoHosting export into an anonymized GDSP session. Returns null if ignored. */
function normalizeSession(raw){
  if(!raw||typeof raw!=='object'||isIgnoredSession(raw)) return null;
  const typeRaw=String(raw.Type||raw.type||'RACE').toUpperCase();
  const type = typeRaw.includes('QUAL')?'QUALIFY':typeRaw.includes('RACE')?'RACE':typeRaw;
  if(type!=='QUALIFY'&&type!=='RACE') return null;
  const rawResults=raw.Results||raw.results||raw.Result||[]; // real exports use singular "Result"
  const maxLaps=Math.max(0,...rawResults.map(r=>Number(r.NumLaps??r.LapCount??0)));
  const results=rawResults.map((r,i)=>({
    driverId:(r.DriverGuid||r.DriverGUID||r.driverGuid)?pseudonymize(r.DriverGuid||r.DriverGUID||r.driverGuid):(r.driverId||null),
    driverName:r.DriverName||r.driverName||'À confirmer',
    position:r.Position??r.position??i+1, // Result array order IS the final classification
    totalTimeSeconds:r.totalTimeSeconds!=null?Number(r.totalTimeSeconds):ms(r.TotalTime),
    bestLapSeconds:r.bestLapSeconds!=null?Number(r.bestLapSeconds):ms(r.BestLap),
    laps:r.NumLaps??r.LapCount??r.laps??null,
    distancePercent:r.DistancePercent??r.distancePercent??((r.NumLaps!=null&&maxLaps)?Math.round(r.NumLaps/maxLaps*1000)/10:100),
    gridPosition:r.GridPosition??r.gridPosition??null, disqualified:!!(r.Disqualified??r.disqualified),
    penaltySeconds:penaltySeconds(r)
  }));
  const lapCounters=new Map();
  const laps=(raw.Laps||raw.laps||[]).map(l=>{ const id=(l.DriverGuid||l.DriverGUID)?pseudonymize(l.DriverGuid||l.DriverGUID):l.driverId;
    const n=(lapCounters.get(id)||0)+1; lapCounters.set(id,n); return normalizeLap(l,n); });
  return { date:raw.Date||raw.date||null, type, track:cleanTrackName(raw.TrackName||raw.Track||raw.track||'À confirmer'),
    trackConfig:raw.TrackConfig||raw.trackConfig||null, eventName:raw.EventName||raw.eventName||null,
    championshipId:raw.ChampionshipID||raw.championshipId||null, sessionFile:raw.SessionFile||raw.sessionFile||null,
    results, laps,
    events:(raw.Events||raw.events||[]).map(e=>({type:e.Type||e.type||'COLLISION',
      // real exports nest the driver: {Driver:{Guid,Name}, OtherDriver:{Guid,Name}}
      driverId:e.DriverGuid?pseudonymize(e.DriverGuid):(e.Driver&&e.Driver.Guid?pseudonymize(e.Driver.Guid):(e.driverId||null)),
      otherDriverId:e.OtherDriverGuid?pseudonymize(e.OtherDriverGuid):(e.OtherDriver&&e.OtherDriver.Guid?pseudonymize(e.OtherDriver.Guid):(e.otherDriverId||null)),
      impactSpeed:e.ImpactSpeed!=null?Number(e.ImpactSpeed):null,
      timeLossSeconds:Number(e.TimeLossSeconds??e.timeLossSeconds??0), cuts:Number(e.Cuts??e.cuts??0)})) };
}
/** Merge sessions, de-duplicated by (date + session type). Existing order preserved. */
function mergeSessions(existing=[], incoming=[]){
  const seen=new Set(existing.map(sessionKey)); const added=[], duplicates=[];
  for(const s of incoming){ if(!s) continue; const k=sessionKey(s); if(seen.has(k)) duplicates.push(s); else {seen.add(k); added.push(s);} }
  return { sessions:[...existing,...added], added, duplicates };
}
function importPayloads(existingSessions, payloads){
  const normalized=[]; for(const p of (Array.isArray(payloads)?payloads:[payloads])){ const s=normalizeSession(p); if(s) normalized.push(s); }
  return mergeSessions(existingSessions, normalized);
}
function cleanTrackName(value){
  const name=String(value||'À confirmer').replace(/\.(json|ini|kn5)$/i,'').replace(/^(ks|ac|acf|ah)_/i,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
  return name.replace(/\b\w/g,c=>c.toUpperCase())||'À confirmer';
}
function nameRounds(sessions=[]){
  const ordered=[...sessions].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  const races=ordered.filter(s=>s.type==='RACE');
  races.forEach((race,i)=>{ race.roundNumber=i+1; race.label=`Manche ${i+1}`; });
  ordered.filter(s=>s.type==='QUALIFY').forEach(q=>{
    const race=races.find(r=>String(r.date||'')>=String(q.date||''))||races[races.length-1];
    if(race){ q.roundNumber=race.roundNumber; q.label=race.label; }
  });
  return sessions;
}
module.exports={sessionKey,isIgnoredSession,normalizeSession,mergeSessions,importPayloads,cleanTrackName,nameRounds};
