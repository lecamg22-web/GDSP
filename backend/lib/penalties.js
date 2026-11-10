'use strict';
/** Commission penalties: [{driverId, seconds}] or per-result penaltySeconds.
 *  Re-ranks race results by (totalTime + penalty), ties keep previous order. Never mutates input. */
function applyPenalties(results, penalties=[]){
  const penMap = new Map();
  for(const p of penalties||[]) penMap.set(p.driverId, (penMap.get(p.driverId)||0) + (Number(p.seconds)||0));
  const decorated = (results||[]).map((r,i)=>({...r,
    penaltySeconds:(Number(r.penaltySeconds)||0)+(penMap.get(r.driverId)||0),
    _orig:i}));
  decorated.sort((a,b)=>{
    const ta=(a.totalTimeSeconds??Infinity)+(a.penaltySeconds||0);
    const tb=(b.totalTimeSeconds??Infinity)+(b.penaltySeconds||0);
    return ta-tb || a._orig-b._orig;
  });
  return decorated.map((r,i)=>{ const {_orig,...rest}=r; return {...rest, position:i+1, adjustedTimeSeconds:(r.totalTimeSeconds==null?null:r.totalTimeSeconds+(r.penaltySeconds||0))}; });
}
module.exports={applyPenalties};
