'use strict';
const crypto = require('node:crypto');
const STEAM_GUID_RE = /^7656119\d{10}$/;
function isSteamGuid(v){ return typeof v==='string' && STEAM_GUID_RE.test(v.trim()); }
/** Deterministic pseudonym: same GUID -> same id, id cannot be reversed to GUID (SHA-256). */
function pseudonymize(guid){
  if(guid==null||guid==='') throw new TypeError('GUID manquant');
  const hash = crypto.createHash('sha256').update(String(guid),'utf8').digest('hex');
  return `pilote-${hash.slice(0,12)}`;
}
/** Deep-clone + strip every Steam GUID string anywhere (keys and values). */
function anonymize(value){
  if(typeof value==='string') return isSteamGuid(value.trim()) ? pseudonymize(value.trim()) : value.replace(/7656119\d{10}/g, m=>pseudonymize(m));
  if(Array.isArray(value)) return value.map(anonymize);
  if(value && typeof value==='object'){
    const out={};
    for(const [k,v] of Object.entries(value)){
      if(/guid/i.test(k) && typeof v==='string' && v) { out.driverId = pseudonymize(v); continue; }
      if(/guid/i.test(k)) continue;
      out[k]=anonymize(v);
    }
    return out;
  }
  return value;
}
function assertNoGuid(payload){ const s=JSON.stringify(payload); const m=s.match(/7656119\d{10}/); if(m) throw new Error('GUID Steam détecté dans la charge utile'); return true; }
module.exports={isSteamGuid,pseudonymize,anonymize,assertNoGuid,STEAM_GUID_RE};
