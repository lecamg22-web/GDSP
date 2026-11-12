'use strict';
const {fetchJson,fetchText}=require('./ahServers');
const DEFAULT_CHAMPIONSHIPS_URL='https://fr2.assettohosting.com:50648/championships';
function decodeHtml(s){ return String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&#039;/g,"'").replace(/&nbsp;/g,' ').trim(); }
function championshipsIndexUrl(input=DEFAULT_CHAMPIONSHIPS_URL){
  const u=new URL(input); if(!['https:','http:'].includes(u.protocol)) throw new Error('URL AssettoHosting invalide');
  return `${u.origin}/championships`;
}
function championshipExportUrl(input){
  const u=new URL(input); if(!['https:','http:'].includes(u.protocol)) throw new Error('URL du championnat invalide');
  const match=u.pathname.match(/^\/championship\/([A-Za-z0-9-]+)(?:\/export)?\/?$/);
  if(!match) throw new Error('Sélectionnez un championnat AssettoHosting');
  return {id:match[1],url:`${u.origin}/championship/${match[1]}`,exportUrl:`${u.origin}/championship/${match[1]}/export`};
}
/** Parse the real /championships HTML table (name, progress, events, classes, entrants). */
function parseChampionshipsHtml(html,sourceUrl=DEFAULT_CHAMPIONSHIPS_URL){
  const base=new URL(championshipsIndexUrl(sourceUrl)).origin, out=[], seen=new Set();
  for(const row of String(html).matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)){
    const link=row[0].match(/<a[^>]+href="([^"]*\/championship\/([A-Za-z0-9-]+))"[^>]*>([\s\S]*?)<\/a>/i);
    if(!link||seen.has(link[2])) continue;
    const cells=[...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>decodeHtml(c[1]));
    const progress=Number.parseFloat(cells[1])||0;
    seen.add(link[2]); out.push({id:link[2],name:decodeHtml(link[3]),url:`${base}/championship/${link[2]}`,
      exportUrl:`${base}/championship/${link[2]}/export`,progress,status:progress>=100?'completed':'active',
      eventCount:Number.parseInt(cells[2],10)||0,classCount:Number.parseInt(cells[3],10)||0,entrantCount:Number.parseInt(cells[4],10)||0});
  }
  return out;
}
/** Find raw session objects anywhere in the export, without persisting entrants or their GUIDs. */
function extractChampionshipSessions(raw){
  const sessions=[], seen=new WeakSet();
  function visit(value){
    if(!value||typeof value!=='object'||seen.has(value)) return; seen.add(value);
    const type=String(value.Type||value.type||'').toUpperCase();
    if((type==='RACE'||type==='QUALIFY')&&(value.Date||value.date)&&(value.Result||value.Results||value.results)){
      sessions.push({...value,ChampionshipID:value.ChampionshipID||raw.ID||raw.id||null,EventName:value.EventName||raw.Name||raw.name||null});
      return;
    }
    if(Array.isArray(value)) for(const item of value) visit(item);
    else for(const item of Object.values(value)) visit(item);
  }
  visit(raw); return sessions;
}
async function listChampionships(url=DEFAULT_CHAMPIONSHIPS_URL,opts={}){
  const indexUrl=championshipsIndexUrl(url), html=await (opts.fetchText||fetchText)(indexUrl);
  return parseChampionshipsHtml(html,indexUrl);
}
function extractPointsConfig(raw){
  const candidates=[raw.Points,raw.RacePoints,raw.PointsConfig,...(Array.isArray(raw.Classes)?raw.Classes.flatMap(c=>[c.Points,c.RacePoints,c.PointsConfig]):[])];
  const value=candidates.find(v=>Array.isArray(v)||v&&typeof v==='object'); if(!value) return null;
  const source=Array.isArray(value)?{scale:value}:value;
  const scale=(source.scale||source.Scale||source.Points||[]).map(Number).filter(Number.isFinite);
  if(!scale.length) return null;
  return {scale,polePoints:Number(source.polePoints??source.PolePoints??0)||0,coefficient:Number(source.coefficient??source.Coefficient??1)||1,jokers:0,minDistancePercent:75};
}
async function readChampionship(url,opts={}){
  const target=championshipExportUrl(url), raw=await (opts.fetchJson||fetchJson)(target.exportUrl);
  return {championship:{id:raw.ID||target.id,name:raw.Name||'Championnat AssettoHosting',url:target.url,exportUrl:target.exportUrl,
    updated:raw.Updated||null,progress:raw.Stats?.Progress??null,eventCount:raw.Stats?.NumEvents??null},payloads:extractChampionshipSessions(raw),pointsConfig:extractPointsConfig(raw)};
}
module.exports={DEFAULT_CHAMPIONSHIPS_URL,championshipsIndexUrl,championshipExportUrl,parseChampionshipsHtml,extractChampionshipSessions,extractPointsConfig,listChampionships,readChampionship};
