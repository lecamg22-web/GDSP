'use strict';
const {applyPenalties}=require('./penalties');
const clamp100=v=>Math.max(0,Math.min(100,v));
function levelFor(score){ if(score==null) return 'Non classé'; if(score<=40) return 'Débutant'; if(score<=60) return 'Intermédiaire'; if(score<=80) return 'Confirmé'; return 'Élite'; }
function recencyWeight(date, now=new Date()){ const ageDays=Math.max(0,(new Date(now)-new Date(date))/86400000); return Math.pow(0.5, ageDays/90); }
/** iRacing-style regularity: best minus average of non-best laps. Lap 1 and laps > best+21s excluded. */
function regularityScore(laps){
  if(!laps||laps.length<3) return null;
  const usable=laps.filter(l=>l.number!==1 && Number.isFinite(l.timeSeconds));
  if(usable.length<2) return null;
  const best=Math.min(...usable.map(l=>l.timeSeconds));
  const nonBest=usable.filter(l=>l.timeSeconds!==best || usable.indexOf(l)!==usable.findIndex(x=>x.timeSeconds===best));
  const clean=nonBest.filter(t=>t.timeSeconds<=best+21);
  if(!clean.length) return null;
  const avg=clean.reduce((s,l)=>s+l.timeSeconds,0)/clean.length;
  return clamp100(100-(avg-best)*12.5);
}
function rankScore(rank, fieldSize){ if(!fieldSize||fieldSize<1) return 0; if(fieldSize===1) return 100; return clamp100((fieldSize-rank)/(fieldSize-1)*100); }
/**
 * Score every driver across events. Per race: speed = rank of best lap (Q+R combined),
 * results = final rank after penalties, cleanliness = 100-10*(time-loss contacts + cuts),
 * regularity as above. Criteria averaged with 90-day half-life weights. Min 5 races.
 */
function computeGlobalRatings(events, {now=new Date(), minRaces=5, excludedDriverIds=[]}={}){
  const excluded=new Set(excludedDriverIds);
  const acc=new Map();
  for(const event of events||[]){
    const sessions=(event.data&&event.data.sessions)||[];
    const races=sessions.filter(s=>s.type==='RACE');
    for(const race of races){
      const weekendBest=new Map();
      for(const s of sessions.filter(x=>x.track===race.track)){
        for(const lap of s.laps||[]) if(lap.driverId&&Number.isFinite(lap.timeSeconds)){
          if(!weekendBest.has(lap.driverId)||lap.timeSeconds<weekendBest.get(lap.driverId)) weekendBest.set(lap.driverId,lap.timeSeconds); }
        for(const r of s.results||[]) if(r.driverId&&Number.isFinite(r.bestLapSeconds)){
          if(!weekendBest.has(r.driverId)||r.bestLapSeconds<weekendBest.get(r.driverId)) weekendBest.set(r.driverId,r.bestLapSeconds); }
      }
      const speedRank=new Map([...weekendBest.entries()].sort((a,b)=>a[1]-b[1]).map(([id],i)=>[id,i+1]));
      const ranked=applyPenalties(race.results||[], event.data?.penMap?.[race.date]||[]);
      for(const r of ranked){
        if(excluded.has(r.driverId)) continue;
        if(!acc.has(r.driverId)) acc.set(r.driverId,{driverId:r.driverId,driverName:r.driverName,races:0,weighted:{regularity:0,proprete:0,vitesse:0,resultats:0},weights:{regularity:0,proprete:0,vitesse:0,resultats:0}});
        const d=acc.get(r.driverId); d.driverName=r.driverName||d.driverName; d.races++;
        const w=recencyWeight(race.date,now);
        const driverLaps=(race.laps||[]).filter(l=>l.driverId===r.driverId);
        const cuts=driverLaps.reduce((s,l)=>s+(l.cuts||0),0)+(race.events||[]).filter(e=>e.driverId===r.driverId).reduce((s,e)=>s+(e.cuts||0),0);
        const timeLossContacts=(race.events||[]).filter(e=>(e.driverId===r.driverId||e.otherDriverId===r.driverId)&&((e.timeLossSeconds>0)||/COLLISION/.test(e.type||''))).length; // real exports: COLLISION_WITH_CAR has impact speed, no time loss
        const scores={ regularite:regularityScore(driverLaps),
          proprete:clamp100(100-10*(timeLossContacts+cuts)),
          vitesse:speedRank.has(r.driverId)?rankScore(speedRank.get(r.driverId), speedRank.size):null,
          resultats:rankScore(r.position, ranked.length) };
        const keyMap={regularite:'regularity',proprete:'proprete',vitesse:'vitesse',resultats:'resultats'};
        // store under French criterion names for output simplicity
        for(const [fr,en] of Object.entries(keyMap)){ if(scores[fr]==null) continue;
          d.weighted[en]=(d.weighted[en]||0); d.weights[en]=(d.weights[en]||0);
          d.weighted[en]+=scores[fr]*w; d.weights[en]+=w; }
        d._fr=d._fr||{regularite:0,proprete:0,vitesse:0,resultats:0}; d._fw=d._fw||{regularite:0,proprete:0,vitesse:0,resultats:0};
        for(const fr of Object.keys(keyMap)){ if(scores[fr]==null) continue; d._fr[fr]+=scores[fr]*w; d._fw[fr]+=w; }
      }
    }
  }
  return [...acc.values()].map(d=>{
    const criteria={}; for(const k of ['regularite','proprete','vitesse','resultats']) criteria[k]=d._fw[k]?Math.round(d._fr[k]/d._fw[k]*10)/10:null;
    const vals=Object.values(criteria).filter(v=>v!=null);
    const score = (d.races>=minRaces && vals.length===4) ? Math.round(vals.reduce((a,b)=>a+b,0)/4*10)/10 : null;
    return {driverId:d.driverId,driverName:d.driverName,races:d.races,criteria,score,level:levelFor(score),ranked:score!=null};
  }).sort((a,b)=>(b.score??-1)-(a.score??-1)||b.races-a.races).map((d,i)=>({...d,position:d.ranked?i+1:null}));
}
module.exports={computeGlobalRatings,regularityScore,recencyWeight,levelFor,rankScore,clamp100};
