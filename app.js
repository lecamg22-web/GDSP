'use strict';
const express=require('express');
const path=require('node:path');
const http=require('node:http'); const https=require('node:https');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TBC='à confirmer';
function backendBase(){ return (process.env.BACKEND_URL||'http://localhost:4000').replace(/\/$/,''); }
async function defaultFetchJson(url){ const r=await fetch(url); if(!r.ok) throw Object.assign(new Error(`Backend HTTP ${r.status}`),{status:r.status}); return r.json(); }
function proxyApi(req,res){
  const base=new URL(backendBase()); const lib=base.protocol==='https:'?https:http;
  const upstream=lib.request({protocol:base.protocol,hostname:base.hostname,port:base.port||undefined,
    path:req.originalUrl, method:req.method, headers:{...req.headers,host:base.host}},up=>{
    res.writeHead(up.statusCode||502,up.headers); up.pipe(res); });
  upstream.on('error',()=>{ if(!res.headersSent){ res.set('Retry-After','30'); res.status(503).send('<h1>Service temporairement indisponible</h1><p>Veuillez réessayer dans quelques instants.</p>'); } });
  req.pipe(upstream);
}
function unavailable(res){ res.set('Retry-After','30'); return res.status(503).send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>GDSP — temporairement indisponible</title></head><body><h1>Service temporairement indisponible</h1><p>Le service de résultats ne répond pas. Veuillez réessayer dans quelques instants.</p></body></html>`); }
function shell({title,description,canonical,body}){
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(canonical)}">
<style> :root{--ink:#102a32;--cream:#f4ecd8;--paper:#f8f2e4;--red:#9c3021;--red2:#a33426;--gold:#cd9a42;--gold2:#d7a347;--line:#bdb09a;--green:#3b6341;--grey:#6d726c} *{box-sizing:border-box} body{margin:0;background:#e9e0cb;color:var(--ink);font-family:Arial,sans-serif} header{background:var(--ink);color:var(--cream);border-bottom:5px solid var(--red2);padding:1rem} header a{color:var(--gold2)} main{max-width:1100px;margin:auto;padding:1rem} h1,h2,h3{font-family:Impact,'Arial Narrow',sans-serif;text-transform:uppercase;letter-spacing:.7px;font-weight:normal;color:var(--ink)} h1{border-bottom:3px solid var(--gold)} a{color:var(--red)} nav button{background:none;border:0;border-bottom:3px solid transparent;color:var(--ink);font-size:13px;font-weight:bold;letter-spacing:1.2px;cursor:pointer;padding:10px 6px;text-transform:uppercase} nav button:hover,nav button.active{border-bottom-color:var(--red);color:var(--red)} table{border-collapse:collapse;width:100%;background:var(--paper);border-top:3px solid var(--ink)} th{background:var(--ink);color:var(--cream);font-family:'Arial Narrow',Arial,sans-serif;text-transform:uppercase;letter-spacing:1px} td,th{border:1px solid var(--line);padding:.35rem .6rem;text-align:left} tr:nth-child(even) td{background:#efe6d0} .card{background:var(--paper);border:1px solid var(--line);border-left:5px solid var(--gold);padding:1rem;margin:.5rem 0} input,select,textarea{background:#fbf7ec;border:1px solid var(--line);color:var(--ink);padding:.4rem} button{cursor:pointer} section[hidden]{display:none} .tagline{font-family:Impact,'Arial Narrow',sans-serif;text-transform:uppercase;color:var(--red);letter-spacing:1px} </style>
</head><body><header><a href="/">Gentleman Drivers Project</a> · <a href="/global">Classement GLOBAL Discord</a></header><main>${body}</main>
<script src="/site.js" defer></script></body></html>`;
}
function createFrontendApp({fetchJson=defaultFetchJson, siteUrl=process.env.SITE_URL||''}={}){
  const app=express();
  app.all('/api/*',proxyApi); // BEFORE express.json: proxy pipes the RAW body (a parsed body would never reach the backend)
  app.use(express.json({limit:'25mb'}));
  app.use(express.static(path.join(__dirname,'public'),{index:false})); // index:false: '/' stays SSR (no-JS visitors)
  app.get('/robots.txt',(req,res)=>res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`));
  app.get('/sitemap.xml',async(req,res)=>{ try{ const events=await fetchJson(`${backendBase()}/api/events`);
    const urls=[`${siteUrl}/`,`${siteUrl}/global`,...events.map(e=>`${siteUrl}/evenements/${e.slug}`)];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${esc(u)}</loc></url>`).join('')}</urlset>`);
  }catch{ return unavailable(res); } });
  app.get('/',async(req,res)=>{ try{
    const [events,stats]=await Promise.all([fetchJson(`${backendBase()}/api/events`),fetchJson(`${backendBase()}/api/stats`)]);
    const list=kind=>events.filter(e=>e.kind===kind).map(e=>`<li><a href="/evenements/${esc(e.slug)}">${esc(e.name)}</a></li>`).join('')||'<li>À confirmer</li>';
    const body=`<h1>Gentleman Drivers Project</h1>
<p class="tagline">La piste, entre gentlemen. Compétition le mercredi, arsouille entre copains toujours.</p><p>Championnats et opens Assetto Corsa historiques, en français. Classements consolidés après chaque soirée de course.</p>
<p><a href="https://discord.com">Rejoindre le Discord</a> · Règlement : respect en piste, aucune aide moderne, fair-play gentleman driver.</p>
<h2>Statistiques globales</h2><p>${stats.events} événements · ${stats.races} courses · ${stats.drivers} pilotes</p>
<h2>Championnats en cours</h2><ul>${list('championship')}</ul><h2>Opens</h2><ul>${list('open')}</ul><h2>Archives</h2><ul>${list('archive')}</ul>`;
    res.send(shell({title:'GDSP — Gentleman Drivers Project',description:'Classements Assetto Corsa historiques GDSP',canonical:`${siteUrl}/`,body}));
  }catch{ return unavailable(res); } });
  app.get('/evenements/:slug',async(req,res)=>{ try{
    const e=await fetchJson(`${backendBase()}/api/events/${encodeURIComponent(req.params.slug)}`);
    const info=e.data.eventInfo||{}; // per-event ONLY: never borrow labels from another event
    const calendar=Object.entries(e.data.customCalendar||{}).map(([k,v])=>`<li>${esc(k)} : ${esc(v||TBC)}</li>`).join('')||'<li>Date à confirmer</li>';
    const rounds=e.data.circuitRounds||[];
    const circuitSection = rounds.length?`<h2>Circuit</h2>${rounds.map(r=>`<article><h3>${esc(r.id)} — ${esc(r.label||TBC)}</h3><p>Date : ${esc(r.date||'Date à confirmer')} · Vainqueur : ${esc(r.winner||TBC)}</p></article>`).join('')}`:'';
    const body=`<h1>${esc(e.name)}</h1><p>${esc(info.description||TBC)}</p>
<h2>Calendrier</h2><ul>${calendar}</ul>${circuitSection}<div id="app" data-slug="${esc(e.slug)}"></div>`;
    res.send(shell({title:`${e.name} — GDSP`,description:info.description||`Classements et résultats : ${e.name}`,canonical:`${siteUrl}/evenements/${e.slug}`,body}));
  }catch(err){ if(err.status===404) return res.status(404).send(shell({title:'Introuvable — GDSP',description:'',canonical:`${siteUrl}/`,body:'<h1>Événement introuvable</h1>'})); return unavailable(res); } });
  app.get('/global',async(req,res)=>{ try{ const rows=await fetchJson(`${backendBase()}/api/global`);
    const body=`<h1>Classement GLOBAL Discord</h1><table><thead><tr><th>#</th><th>Pilote</th><th>Note /100</th><th>Niveau</th><th>Courses</th></tr></thead><tbody>${
      rows.map(r=>`<tr><td>${r.position??'—'}</td><td>${esc(r.driverName)}</td><td>${r.score??TBC}</td><td>${esc(r.level)}</td><td>${r.races}</td></tr>`).join('')}</tbody></table>`;
    res.send(shell({title:'Classement GLOBAL Discord — GDSP',description:'Classement global GDSP sur 100',canonical:`${siteUrl}/global`,body}));
  }catch{ return unavailable(res); } });
  return app;
}
module.exports={createFrontendApp,shell,esc};
