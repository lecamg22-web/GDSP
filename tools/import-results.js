#!/usr/bin/env node
'use strict';
/* Usage: BACKEND_URL=... ADMIN_TOKEN=... node tools/import-results.js <slug> <file.json...>  (unit or bulk) */
const fs=require('node:fs');
(async()=>{
  const [slug,...files]=process.argv.slice(2);
  if(!slug||!files.length||!process.env.BACKEND_URL||!process.env.ADMIN_TOKEN){ console.error('BACKEND_URL, ADMIN_TOKEN, <slug> et fichiers requis'); process.exit(2); }
  const payloads=files.map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
  const r=await fetch(`${process.env.BACKEND_URL}/api/admin/events/${slug}/import`,{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.ADMIN_TOKEN}`},body:JSON.stringify({payloads})});
  console.log(await r.text()); if(!r.ok) process.exit(1);
})().catch(e=>{ console.error(e.message); process.exit(1); });
