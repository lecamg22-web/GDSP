'use strict';
const DEFAULT_POINTS_CONFIG = Object.freeze({
  scale:[25,18,15,12,10,8,6,4,2,1], polePoints:1, coefficient:1, jokers:0, minDistancePercent:75
});
function normalizePointsConfig(cfg={}){ return {...DEFAULT_POINTS_CONFIG, ...(cfg||{}),
  scale:Array.isArray(cfg.scale)&&cfg.scale.length?cfg.scale.slice():DEFAULT_POINTS_CONFIG.scale.slice()}; }
function raceDistancePercent(result){
  if(typeof result.distancePercent==='number') return result.distancePercent;
  if(typeof result.DistancePercent==='number') return result.DistancePercent;
  if(result.laps!=null && result.totalLaps) return result.laps/result.totalLaps*100;
  return 100;
}
function pointsForResult(result, config, {isPole=false,isBestLap=false,multiplier=null}={}){
  const cfg=normalizePointsConfig(config);
  if(raceDistancePercent(result) < cfg.minDistancePercent) return 0;
  const pos = result.position ?? result.Position;
  let pts = (pos>=1 && cfg.scale[pos-1]!=null) ? cfg.scale[pos-1] : 0;
  if(isPole) pts += cfg.polePoints;
  if(isBestLap) pts += Number(cfg.bestLapPoints)||0;
  return pts * (multiplier??cfg.coefficient);
}
/** Drop the `jokers` lowest-scoring rounds. Returns {total, droppedRoundIndexes, counted}. */
function applyJokers(roundPoints, jokers=0){
  const indexed = roundPoints.map((points,i)=>({points,roundIndex:i}));
  const dropCount = Math.min(Math.max(0,jokers|0), Math.max(0,indexed.length-1));
  const dropped = [...indexed].sort((a,b)=>a.points-b.points).slice(0,dropCount);
  const droppedSet = new Set(dropped.map(d=>d.roundIndex));
  return { total: indexed.filter(x=>!droppedSet.has(x.roundIndex)).reduce((s,x)=>s+x.points,0),
    droppedRoundIndexes:[...droppedSet].sort((a,b)=>a-b), counted: indexed.filter(x=>!droppedSet.has(x.roundIndex)) };
}
module.exports={DEFAULT_POINTS_CONFIG,normalizePointsConfig,raceDistancePercent,pointsForResult,applyJokers};
