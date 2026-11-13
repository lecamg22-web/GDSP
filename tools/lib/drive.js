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
function extractFolderRef(url){
  const s=String(url||'');
  const match=s.match(/[?&](?:resourcekey|resourceKey)=([^&#]+)/i);
  let resourceKey=null;
  if(match) try{ resourceKey=decodeURIComponent(match[1].replace(/\+/g,' ')); }catch{ resourceKey=match[1]; }
  return {id:extractFolderId(s),resourceKey};
}
function withResourceKey(url,resourceKey){ return resourceKey?`${url}&resourcekey=${encodeURIComponent(resourceKey)}`:url; }
function folderEmbedUrl(folderId,resourceKey){ return withResourceKey(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`,resourceKey)+'#list'; }
function downloadUrl(fileId,resourceKey){ return withResourceKey(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,resourceKey); }
/** Parse the public embedded folder HTML. Injectable/pure for tests. */
function parseDriveFolderHtml(html){
  const files=[]; const seen=new Set();
  const re=/data-id="([A-Za-z0-9_-]{10,})"[^>]*>[\s\S]{0,300}?flip-entry-title[^>]*>([^<]+)</g;
  let m; while((m=re.exec(String(html)))){ if(!seen.has(m[1])){
    seen.add(m[1]); const start=m.index, snippet=String(html).slice(start,start+800);
    const key=snippet.match(/(?:data-resourcekey|resourcekey|resourceKey)["'=:\s]+["']?([A-Za-z0-9_-]{10,})/i)?.[1]||null;
    files.push({id:m[1],name:m[2].trim(),resourceKey:key});
  } }
  if(!files.length){ // fallback: JSON-ish fragments embedded by Drive
    const re2=/"([A-Za-z0-9_-]{20,})"\s*,\s*"([^"]+\.(?:ai|ini|json))"/gi;
    while((m=re2.exec(String(html)))){ if(!seen.has(m[1])){ seen.add(m[1]); files.push({id:m[1],name:m[2],resourceKey:null}); } }
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
function driveHttpError(status){
  if(status===401||status===403) return new Error(`Google Drive refuse l’accès (HTTP ${status}). Vérifiez que le dossier et ses fichiers sont accessibles en « Tous les utilisateurs disposant du lien » avec le rôle Lecteur. Si le lien contient « resourcekey=… », collez le lien complet.`);
  if(status===404) return new Error('Google Drive ne trouve pas ce dossier ou ce fichier (HTTP 404). Vérifiez le lien et le partage.');
  return new Error(`Google Drive a répondu HTTP ${status}.`);
}
async function fetchText(url, fetchFn=globalThis.fetch){ const r=await fetchFn(url); if(!r.ok) throw driveHttpError(r.status); return r.text(); }
async function fetchBuffer(url, fetchFn=globalThis.fetch){ const r=await fetchFn(url); if(!r.ok) throw driveHttpError(r.status); return Buffer.from(await r.arrayBuffer()); }
async function listDriveFolder(folderUrl, fetchFn=globalThis.fetch){
  const {id,resourceKey}=extractFolderRef(folderUrl);
  return parseDriveFolderHtml(await fetchText(folderEmbedUrl(id,resourceKey),fetchFn));
}
module.exports={extractFolderId,extractFolderRef,folderEmbedUrl,downloadUrl,parseDriveFolderHtml,pickCircuitFiles,listDriveFolder,fetchText,fetchBuffer,REQUIRED,OPTIONAL};
