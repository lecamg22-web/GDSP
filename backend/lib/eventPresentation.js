'use strict';
function cleanEventName(value){
  let name=String(value||'Événement GDSP').replace(/[|]+/g,'/').replace(/\s+/g,' ').trim();
  const repeated=name.match(/^(.+?)\s*\/\s*\1(?:\s+\1)*$/i); if(repeated) name=repeated[1];
  name=name.split('/').map(s=>s.trim()).filter(Boolean).filter((s,i,a)=>a.indexOf(s)===i).join(' / ');
  const parts=name.split(/\s+/), out=[]; for(const p of parts){ if(p.toLowerCase()!==out[out.length-1]?.toLowerCase()) out.push(p); }
  return out.join(' ')||'Événement GDSP';
}
function displayTrack(value){ return String(value||'À confirmer').replace(/\.(json|ini|kn5)$/i,'').replace(/^(ks|ac|acf|ah)_/i,'').replace(/[_-]+/g,' ').replace(/([a-z])([0-9]{2,4})/gi,'$1 $2').replace(/\s+/g,' ').trim().replace(/\b\w/g,c=>c.toUpperCase()); }
function validDate(value){ const d=new Date(value); return Number.isNaN(d.getTime())?null:d.toISOString(); }
function calendar(event){
  const sessions=event.data.sessions||[], days=new Map();
  for(const s of sessions.filter(s=>s.type==='RACE'||s.type==='QUALIFY')){
    const day=String(s.date||'').slice(0,10)||'date-inconnue';
    if(!days.has(day))days.set(day,{day,races:[],qualify:[]});
    days.get(day)[s.type==='RACE'?'races':'qualify'].push(s);
  }
  return [...days.values()].sort((a,b)=>a.day.localeCompare(b.day)).map((d,i)=>{
    d.races.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))); d.qualify.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
    const winners=d.races.map((r,n)=>({race:n+1,driverName:r.results?.find(x=>Number(x.position)===1)?.driverName||null}));
    return {round:i+1,label:`Manche ${i+1}`,track:displayTrack(d.races[0]?.track||d.qualify[0]?.track),config:d.races[0]?.trackConfig||null,date:validDate(d.races[0]?.date)||d.races[0]?.date||null,qualifyDate:d.qualify[0]?(validDate(d.qualify[0].date)||d.qualify[0].date):null,raceCount:d.races.length,races:d.races.map((r,n)=>({race:n+1,date:validDate(r.date)||r.date||null,track:displayTrack(r.track)})),winners,status:d.races.some(r=>r.results?.length)?'Terminée':'À confirmer'};
  });
}
function raceAnalyses(event){
  const sessions=event.data.sessions||[], races=sessions.filter(s=>s.type==='RACE').sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  const qualify=sessions.filter(s=>s.type==='QUALIFY');
  return races.map((r,i)=>{
    const q=qualify.filter(x=>String(x.date||'')<=String(r.date||'')).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0];
    const grid=new Map((q?.results||[]).map(x=>[x.driverId,x.position]));
    const results=[...(r.results||[])].sort((a,b)=>a.position-b.position).map(x=>({...x,gridPosition:x.gridPosition||grid.get(x.driverId)||null,gained:(x.gridPosition||grid.get(x.driverId))?(x.gridPosition||grid.get(x.driverId))-x.position:null,gapSeconds:x.totalTimeSeconds&&resultsTotal(r)?x.totalTimeSeconds-resultsTotal(r):null}));
    const best=[...(r.results||[])].filter(x=>x.bestLapSeconds).sort((a,b)=>a.bestLapSeconds-b.bestLapSeconds)[0]||null;
    const pole=[...(q?.results||[])].sort((a,b)=>a.position-b.position)[0]||null;
    const laps=r.laps||[], cuts=laps.reduce((n,l)=>n+(l.cuts||0),0);
    const byDriver={}; for(const l of laps){ if(!l.driverId||!l.timeSeconds) continue; (byDriver[l.driverId]??=[]).push(l.timeSeconds); }
    const consistency=Object.entries(byDriver).map(([driverId,times])=>({driverId,average:times.reduce((a,b)=>a+b,0)/times.length,best:Math.min(...times),laps:times.length}));
    return {round:i+1,label:`Manche ${i+1}`,track:displayTrack(r.track),date:r.date,qualifyDate:q?.date||null,results,pole,bestLap:best?{driverName:best.driverName,timeSeconds:best.bestLapSeconds}:null,participants:results.length,finishers:results.filter(x=>!x.disqualified&&x.totalTimeSeconds).length,totalLaps:results.reduce((n,x)=>n+(Number(x.laps)||0),0),incidents:(r.events||[]).length,cuts,consistency};
  });
}
function resultsTotal(r){ return r.results?.find(x=>Number(x.position)===1)?.totalTimeSeconds||null; }
function eventInsights(event){
  const races=raceAnalyses(event), drivers=new Map();
  for(const race of races) for(const r of race.results){ const d=drivers.get(r.driverId)||{driverId:r.driverId,driverName:r.driverName,races:0,wins:0,podiums:0,top5:0,poles:0,bestLaps:0,finishers:0,gained:0,incidents:0}; d.races++; if(r.position===1)d.wins++; if(r.position<=3)d.podiums++; if(r.position<=5)d.top5++; if(r.gridPosition===1)d.poles++; if(race.bestLap?.driverName===r.driverName)d.bestLaps++; if(r.totalTimeSeconds&&!r.disqualified)d.finishers++; d.gained+=r.gained||0; drivers.set(r.driverId,d); }
  for(const s of event.data.sessions||[]) for(const e of s.events||[]){ const d=drivers.get(e.driverId); if(d)d.incidents++; }
  const comeback=[...drivers.values()].sort((a,b)=>b.gained-a.gained)[0]||null;
  const tracks={}; for(const r of races){ tracks[r.track]??={track:r.track,editions:0,winners:[],records:[]}; tracks[r.track].editions++; if(r.results[0])tracks[r.track].winners.push(r.results[0].driverName); if(r.bestLap)tracks[r.track].records.push(r.bestLap); }
  return {races,drivers:[...drivers.values()],tracks:Object.values(tracks),summary:{participants:drivers.size,races:races.length,finishers:races.reduce((n,r)=>n+r.finishers,0),totalLaps:races.reduce((n,r)=>n+r.totalLaps,0),incidents:races.reduce((n,r)=>n+r.incidents,0),cuts:races.reduce((n,r)=>n+r.cuts,0),comeback}};
}
module.exports={cleanEventName,displayTrack,calendar,raceAnalyses,eventInsights};
