'use strict';
/** Google Drive public folder access WITHOUT any API key.
 *  Folder must be shared "anyone with the link". We read the public embedded
 *  folder page and extract file ids/names, then download via uc?export=download. */
function extractFolderId(url){
  const s=String(url||'');
  const m=s.match(/folders\/([A-Za-z0-9_-]{10,})/)||s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if(m) return m[1];
  if(/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  throw new Error('URL de dossier Google Drive invalide');
}
function folderEmbedUrl(folderId){ return `https://drive.google.com/embeddedfolderview?id=${folderId}#list`; }
function downloadUrl(fileId){ return `https://drive.google.com/uc?export=download&id=${fileId}`; }
/** Parse the public embedded folder HTML. Injectable/pure for tests. */
function parseDriveFolderHtml(html){
  const files=[]; const seen=new Set();
  const re=/data-id="([A-Za-z0-9_-]{10,})"[^>]*>[\s\S]{0,300}?flip-entry-title[^>]*>([^<]+)</g;
  let m; while((m=re.exec(String(html)))){ if(!seen.has(m[1])){ seen.add(m[1]); files.push({id:m[1], name:m[2].trim()}); } }
  if(!files.length){ // fallback: JSON-ish fragments embedded by Drive
    const re2=/"([A-Za-z0-9_-]{20,})"\s*,\s*"([^"]+\.(?:ai|ini|json))"/gi;
    while((m=re2.exec(String(html)))){ if(!seen.has(m[1])){ seen.add(m[1]); files.push({id:m[1], name:m[2]}); } }
  }
  return files;
}
const REQUIRED='fast_lane.ai', OPTIONAL=['surfaces.ini','overlays.ini','ui_track.json'];
function pickCircuitFiles(files){
  const byName=new Map(files.map(f=>[f.name.toLowerCase(),f]));
  if(!byName.has(REQUIRED)) throw new Error('fast_lane.ai introuvable dans le dossier Drive');
  const picked={fastLane:byName.get(REQUIRED)};
  for(const name of OPTIONAL){ const key=name.replace('.json','').replace('.ini','');
    if(byName.has(name)) picked[key==='ui_track'?'uiTrack':key]=byName.get(name); }
  return picked;
}
async function fetchText(url, fetchFn=globalThis.fetch){ const r=await fetchFn(url); if(!r.ok) throw new Error(`Drive: HTTP ${r.status}`); return r.text(); }
async function fetchBuffer(url, fetchFn=globalThis.fetch){ const r=await fetchFn(url); if(!r.ok) throw new Error(`Drive: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); }
async function listDriveFolder(folderUrl, fetchFn=globalThis.fetch){
  const id=extractFolderId(folderUrl); return parseDriveFolderHtml(await fetchText(folderEmbedUrl(id),fetchFn)); }
module.exports={extractFolderId,folderEmbedUrl,downloadUrl,parseDriveFolderHtml,pickCircuitFiles,listDriveFolder,fetchText,fetchBuffer,REQUIRED,OPTIONAL};
