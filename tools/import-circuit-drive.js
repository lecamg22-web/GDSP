#!/usr/bin/env node
'use strict';
/* Usage: BACKEND_URL=... ADMIN_TOKEN=... node tools/import-circuit-drive.js <slug> <driveFolderUrl> <M1> [label]
   No Google API key: reads the public Drive folder, builds the fiche, POSTs preview then saves it. */
const {listDriveFolder,pickCircuitFiles,downloadUrl,fetchBuffer,fetchText}=require('./lib/drive');
const {buildCircuitRound}=require('../backend/lib/circuit');
(async()=>{
  const [slug,folderUrl,roundId='M1',label]=process.argv.slice(2);
  if(!slug||!folderUrl){ console.error('Usage: node tools/import-circuit-drive.js <slug> <driveFolderUrl> <M1> [label]'); process.exit(2); }
  const files=await listDriveFolder(folderUrl); const picked=pickCircuitFiles(files);
  const get=async f=>f?fetchText(downloadUrl(f.id)):null;
  const round=buildCircuitRound({roundId,label,fastLaneBuffer:await fetchBuffer(downloadUrl(picked.fastLane.id)),
    surfacesText:await get(picked.surfaces),overlaysText:await get(picked.overlays),uiTrackText:await get(picked.uiTrack)});
  console.log(JSON.stringify(round,null,2));
  if(process.env.BACKEND_URL&&process.env.ADMIN_TOKEN){
    const r=await fetch(`${process.env.BACKEND_URL}/api/admin/events/${slug}/circuits`,{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.ADMIN_TOKEN}`},body:JSON.stringify(round)});
    if(!r.ok) throw new Error(`Backend HTTP ${r.status}`); console.error('Fiche enregistrée.');
  }
})().catch(e=>{ console.error(e.message); process.exit(1); });
