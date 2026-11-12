'use strict';
const {normalizePointsConfig,pointsForResult,applyJokers}=require('./points');
const {applyPenalties}=require('./penalties');
function raceSessions(event){ return ((event.data&&event.data.sessions)||[]).filter(s=>s.type==='RACE'); }
function poleDriverId(event, race){
  const q=((event.data&&event.data.sessions)||[]).filter(s=>s.type==='QUALIFY'&&s.track===race.track&&(!race.date||!s.date||s.date<=race.date))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
  if(!q||!q.results||!q.results.length) return null;
  return [...q.results].sort((a,b)=>(a.bestLapSeconds??Infinity)-(b.bestLapSeconds??Infinity))[0].driverId;
}
/** General standings with Commission penalties re-ranking each race, pole bonus, jokers. */
function computeStandings(event, penaltiesBySession={}){
  const cfg=normalizePointsConfig(event.points_config||event.pointsConfig);
  const perDriver=new Map();
  raceSessions(event).forEach((race,roundIndex)=>{
    const pm = penaltiesBySession[roundIndex] || event.data?.penMap?.[roundIndex]
      || event.data?.penMap?.[race.date] || event.data?.penMap?.[`${race.date}|RACE`] || [];
    const ranked=applyPenalties(race.results||[], pm);
    const pole=poleDriverId(event,race);
    const bestLap=[...(race.results||[])].filter(r=>r.bestLapSeconds).sort((a,b)=>a.bestLapSeconds-b.bestLapSeconds)[0]?.driverId;
    const sameDay=raceSessions(event).filter(r=>String(r.date||'').slice(0,10)===String(race.date||'').slice(0,10));
    const multiplier=sameDay.indexOf(race)===1?Number(cfg.secondRaceMultiplier)||cfg.coefficient:cfg.coefficient;
    for(const r of ranked){
      if(!perDriver.has(r.driverId)) perDriver.set(r.driverId,{driverId:r.driverId,driverName:r.driverName,roundPoints:[],wins:0,races:0});
      const d=perDriver.get(r.driverId); d.driverName=r.driverName||d.driverName;
      while(d.roundPoints.length<roundIndex) d.roundPoints.push(0);
      d.roundPoints[roundIndex]=pointsForResult(r,cfg,{isPole:r.driverId===pole,isBestLap:r.driverId===bestLap,multiplier});
      d.races++; if(r.position===1) d.wins++;
    }
    for(const d of perDriver.values()) while(d.roundPoints.length<=roundIndex) d.roundPoints.push(0);
  });
  return [...perDriver.values()].map(d=>{ const j=applyJokers(d.roundPoints,cfg.jokers);
    return {...d,total:j.total,droppedRoundIndexes:j.droppedRoundIndexes}; })
    .sort((a,b)=>b.total-a.total||b.wins-a.wins||String(a.driverName).localeCompare(String(b.driverName),'fr'))
    .map((d,i)=>({...d,position:i+1}));
}
module.exports={computeStandings,poleDriverId,raceSessions};
