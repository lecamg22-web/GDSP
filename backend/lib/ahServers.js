'use strict';
/**
 * AssettoHosting (Assetto Server Manager) auto-import.
 * The /results page is HTML, not JSON: it lists /results/download/<file>.json
 * links, paginated with ?page=n, searchable with ?q=Type:RACE (Bleve syntax).
 * We therefore scan the index (RACE + QUALIFY only, PRACTICE never downloaded),
 * then download each session JSON and let importResult de-duplicate.
 * Servers are pure configuration (admin UI / AH_SERVER_URLS): adding a 3rd
 * server next year needs no code change.
 */
const DEFAULT_AH_SERVERS=[
  {name:'GDSP #1 (fr2)', url:'https://fr2.assettohosting.com:50648/results'},
  {name:'GDSP #2 (fr5)', url:'https://fr5.assettohosting.com:50145/results'}
];
function defaultServers(){
  const env=(process.env.AH_SERVER_URLS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(env.length) return env.map((url,i)=>({name:`Serveur ${i+1}`, url}));
  return DEFAULT_AH_SERVERS.map(s=>({...s}));
}
function resultsIndexUrl(base, type, page=0){
  const b=String(base).replace(/\/$/,'');
  return `${b}?q=${encodeURIComponent(`Type:${type}`)}&page=${page}`;
}
function downloadUrl(base, file){
  return `${String(base).replace(/\/results\/?$/,'')}/results/download/${file}`;
}
/** Parse a /results index page -> [{file, type}] for downloadable session JSONs. */
function parseResultsIndexHtml(html){
  const out=[]; const seen=new Set();
  const re=/results\/download\/([A-Za-z0-9_]+\.json)/g; let m;
  while((m=re.exec(String(html)))){ const file=m[1]; if(seen.has(file)) continue; seen.add(file);
    const type=(file.match(/_(RACE|QUALIFY|PRACTICE)\.json$/)||[])[1]||null;
    out.push({file, type}); }
  return out;
}
async function defaultFetchText(url){ const r=await fetch(url); if(!r.ok) throw new Error(`AssettoHosting HTTP ${r.status} (${url})`); return r.text(); }
async function defaultFetchJson(url){ const r=await fetch(url); if(!r.ok) throw new Error(`AssettoHosting HTTP ${r.status} (${url})`); return r.json(); }
/**
 * Scan one server. Returns raw session payloads (RACE + QUALIFY).
 * Only the most recent pages are scanned (default 4 pages x 25 = 100 sessions
 * per type): de-duplication by (date + type) makes re-scans cheap and safe.
 */
async function scanServer(server, {fetchText=defaultFetchText, fetchJson=defaultFetchJson, maxPages=4}={}){
  const base=server.resultsUrl||server.url;
  if(!base) throw new Error('Serveur AssettoHosting sans URL');
  if(/\.json($|\?)/.test(base)) return [await fetchJson(base)]; // direct session/result file
  const payloads=[];
  for(const type of ['RACE','QUALIFY']){
    for(let page=0; page<(server.maxPages||maxPages); page++){
      const html=await fetchText(resultsIndexUrl(base, type, page));
      const entries=parseResultsIndexHtml(html).filter(e=>e.type===type);
      if(!entries.length) break;
      for(const e of entries) payloads.push(await fetchJson(downloadUrl(base, e.file)));
      if(entries.length<25) break;
    }
  }
  return payloads;
}
module.exports={DEFAULT_AH_SERVERS,defaultServers,resultsIndexUrl,downloadUrl,parseResultsIndexHtml,scanServer,fetchJson:defaultFetchJson,fetchText:defaultFetchText};
