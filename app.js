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
function unavailable(res){ res.set('Retry-After','30'); return res.status(503).send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GDSP — temporairement indisponible</title><link rel="stylesheet" href="/theme.css"></head><body><main><section class="content-card"><h1>Service temporairement indisponible</h1><p>Le service de résultats ne répond pas. Veuillez réessayer dans quelques instants.</p></section></main></body></html>`); }
function shell({title,description,canonical,body}){
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="theme-color" content="#102a32"><link rel="canonical" href="${esc(canonical)}">
<link rel="stylesheet" href="/theme.css">
</head><body><a class="skip-link" href="#contenu">Aller au contenu</a><header class="site-header"><div class="header-inner">
<a class="brand" href="/" aria-label="GDSP — accueil"><span class="brand-mark" aria-hidden="true">GDSP</span><span><span class="brand-name">Gentleman Drivers Project</span><span class="brand-subtitle">La piste, entre gentlemen</span></span></a>
<nav class="site-nav" aria-label="Navigation principale"><a href="/">Accueil</a><a class="nav-events" href="/#championnats">Événements</a><a href="/global">Classement global</a><a class="nav-highlight" href="/index.html">Espace membre</a></nav>
</div></header><main id="contenu">${body}</main>
<footer class="site-footer"><div class="footer-inner"><span>© Gentleman Drivers Project · Assetto Corsa historique</span><span>Compétition le mercredi. Arsouille entre copains toujours.</span></div></footer>
<script src="/site.js" defer></script></body></html>`;
}
function createFrontendApp({fetchJson=defaultFetchJson, siteUrl=process.env.SITE_URL||'', proxy=true}={}){
  const app=express();
  if(proxy) app.all('/api/*',proxyApi); // Separate services: forward the RAW body before parsing JSON.
  else app.all('/api/*',(req,res)=>res.status(404).json({error:'Route API introuvable'})); // Unified service: never proxy to ourselves.
  app.use(express.json({limit:'25mb'}));
  app.use(express.static(path.join(__dirname,'public'),{index:false})); // index:false: '/' stays SSR (no-JS visitors)
  app.get('/robots.txt',(req,res)=>res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`));
  app.get('/sitemap.xml',async(req,res)=>{ try{ const events=await fetchJson(`${backendBase()}/api/events`);
    const urls=[`${siteUrl}/`,`${siteUrl}/global`,...events.map(e=>`${siteUrl}/evenements/${e.slug}`)];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${esc(u)}</loc></url>`).join('')}</urlset>`);
  }catch{ return unavailable(res); } });
  app.get('/',async(req,res)=>{ try{
    const [events,stats]=await Promise.all([fetchJson(`${backendBase()}/api/events`),fetchJson(`${backendBase()}/api/stats`)]);
    const kindLabels={championship:'Championnat',cup:'Cup',open:'Open',archive:'Archive'};
    const cards=kind=>events.filter(e=>e.kind===kind).map(e=>`<article class="event-card"><div><span class="event-kind">${kindLabels[kind]}</span><h3><a href="/evenements/${esc(e.slug)}">${esc(e.name)}</a></h3></div><span class="event-link">Voir l’événement →</span></article>`).join('')||'<p class="empty-card">Programme à confirmer.</p>';
    const section=(kind,title,subtitle,id)=>`<section class="section" id="${id}"><div class="section-heading"><div><p class="eyebrow">Le programme GDSP</p><h2>${title}</h2></div><p>${subtitle}</p></div><div class="event-grid">${cards(kind)}</div></section>`;
    const body=`<section class="hero"><div class="hero-copy"><p class="eyebrow">Assetto Corsa · Simracing historique</p>
<h1>La piste,<em>entre gentlemen.</em></h1>
<p class="tagline">Compétition le mercredi. Arsouille entre copains toujours. Des championnats historiques, des résultats consolidés et le plaisir de courir ensemble.</p>
<div class="hero-actions"><a class="button" href="#championnats">Découvrir les championnats</a><a class="button button-secondary" href="/global">Classement global</a></div></div>
<div class="hero-emblem" aria-hidden="true"><div class="emblem-ring"><div><div class="emblem-gdsp">GDSP</div><div class="emblem-year">Gentleman Drivers</div></div></div><p>Fair-play · Historique<br>Entre copains</p></div></section>
<section class="stats-grid" aria-label="Statistiques globales"><div class="stat"><strong class="stat-value">${stats.events}</strong><span class="stat-label">Événement${stats.events>1?'s':''}</span></div><div class="stat"><strong class="stat-value">${stats.races}</strong><span class="stat-label">Course${stats.races>1?'s':''}</span></div><div class="stat"><strong class="stat-value">${stats.drivers}</strong><span class="stat-label">Pilote${stats.drivers>1?'s':''}</span></div></section>
${section('championship','Championnats en cours','La régularité récompensée, course après course.','championnats')}
${section('cup','Cups','Des mini-championnats intenses, sur quelques manches.','cups')}
${section('open','Opens','Une soirée, un plateau, une nouvelle histoire.','opens')}
${section('archive','Archives','Les saisons et les souvenirs du club.','archives')}
<aside class="club-banner"><div><p class="eyebrow">Rejoindre le club</p><h2>Plus qu’un championnat, une bande de copains.</h2><p>Respect en piste, aucune aide moderne et fair-play gentleman driver. Retrouvez la communauté sur Discord pour les prochaines soirées de course.</p></div><a class="button" href="https://discord.com">Rejoindre le Discord</a></aside>`;
    res.send(shell({title:'GDSP — Gentleman Drivers Project',description:'Classements Assetto Corsa historiques GDSP',canonical:`${siteUrl}/`,body}));
  }catch{ return unavailable(res); } });
  app.get('/evenements/:slug',async(req,res)=>{ try{
    const e=await fetchJson(`${backendBase()}/api/events/${encodeURIComponent(req.params.slug)}`);
    const info=e.data.eventInfo||{}; // per-event ONLY: never borrow labels from another event
    const formatDate=value=>{ const d=new Date(value); return Number.isNaN(d.getTime())?TBC:d.toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}); };
    const calendar=(e.data.autoCalendar||[]).length?e.data.autoCalendar.map(r=>`<li><strong>${esc(r.label)} · ${esc(r.track)}</strong> — ${esc(formatDate(r.date))}${r.qualifyDate?` · Qualification : ${esc(formatDate(r.qualifyDate))}`:''}${r.raceCount>1?` · ${r.raceCount} courses`:''}${(r.winners||[]).filter(w=>w.driverName).map(w=>` · ${r.raceCount>1?`Course ${w.race} : `:'Vainqueur : '}${esc(w.driverName)}`).join('')}</li>`).join(''):Object.entries(e.data.customCalendar||{}).map(([k,v])=>`<li>${esc(k)} : ${esc(v||TBC)}</li>`).join('')||'<li>Date à confirmer</li>';
    const cleanTrack=value=>String(value||TBC).replace(/\.(json|ini|kn5)$/i,'').replace(/^(ks|ac|acf|ah)_/i,'').replace(/[_-]+/g,' ').replace(/([a-z])([0-9]{2,4})/gi,'$1 $2').replace(/\b\w/g,c=>c.toUpperCase());
    const oldRaces=(e.data.sessions||[]).filter(s=>s.type==='RACE').sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
    const rounds=e.data.circuitRounds?.length?e.data.circuitRounds:oldRaces.map((r,i)=>({id:`M${i+1}`,label:cleanTrack(r.track),date:r.date,winner:r.results?.find(x=>Number(x.position)===1)?.driverName||null}));
    const circuitSection = rounds.length?`<section class="section"><h2>Circuits</h2>${rounds.map(r=>`<article class="content-card"><h3>${esc(r.id)} — ${esc(r.label||TBC)}</h3><p>Date : ${esc(r.date||'Date à confirmer')} · Vainqueur : ${esc(r.winner||TBC)}</p></article>`).join('')}</section>`:'';
    const points=e.points_config?.scale?`<section class="section content-card" id="bareme"><h2>Barème de points</h2><p>${e.points_config.scale.map((p,i)=>`P${i+1} : ${p} point${p>1?'s':''}`).join(' · ')}</p><p>Pole position : <strong>+${Number(e.points_config.polePoints)||0} point${Number(e.points_config.polePoints)>1?'s':''}</strong> · Coefficient des courses : <strong>×${Number(e.points_config.coefficient)||1}</strong>${Number(e.points_config.coefficient)===2?' — manche comptant double':''}</p></section>`:'<section class="section content-card" id="bareme"><h2>Barème de points</h2><p>Barème non fourni par l’export AssettoHosting — à confirmer.</p></section>';
    const media=`${e.data.posterImage?`<img class="event-poster" src="${esc(e.data.posterImage)}" alt="Affiche de ${esc(e.name)}">`:''}${(e.data.galleryImages||[]).length?`<section class="section"><h2>Galerie</h2><div class="event-gallery">${e.data.galleryImages.map((src,i)=>`<img src="${esc(src)}" alt="Photo ${i+1} de ${esc(e.name)}">`).join('')}</div></section>`:''}`;
    const body=`<header class="page-title"><p class="eyebrow">Événement GDSP</p><h1>${esc(e.name)}</h1><p class="page-intro">${esc(info.description||TBC)}</p></header>${media}${points}
<section class="section content-card"><h2>Calendrier</h2><ul>${calendar}</ul></section>${circuitSection}<div id="app" data-slug="${esc(e.slug)}">
<nav id="tabs" class="tabs" aria-label="Onglets événement"><button class="active" data-tab="infos">Accueil &amp; Infos</button><button data-tab="standings">Classements</button><button data-tab="results">Résultats</button><button data-tab="circuit" id="tab-circuit" hidden>Circuit</button><button data-tab="drivers">Pilotes</button></nav>
<section data-panel="infos"></section><section data-panel="standings" hidden></section><section data-panel="results" hidden></section><section data-panel="circuit" hidden></section><section data-panel="drivers" hidden></section></div>`;
    res.send(shell({title:`${e.name} — GDSP`,description:info.description||`Classements et résultats : ${e.name}`,canonical:`${siteUrl}/evenements/${e.slug}`,body}));
  }catch(err){ if(err.status===404) return res.status(404).send(shell({title:'Introuvable — GDSP',description:'',canonical:`${siteUrl}/`,body:'<header class="page-title"><h1>Événement introuvable</h1></header>'})); return unavailable(res); } });
  app.get('/global',async(req,res)=>{ try{ const rows=await fetchJson(`${backendBase()}/api/global`);
    const body=`<header class="page-title"><p class="eyebrow">Toute la communauté</p><h1>Classement GLOBAL Discord</h1><p class="page-intro">La note des pilotes GDSP, calculée sur leurs courses, leur régularité et leur fair-play.</p></header><section class="section table-wrap"><table><thead><tr><th>#</th><th>Pilote</th><th>Note /100</th><th>Niveau</th><th>Courses</th></tr></thead><tbody>${
      rows.map(r=>`<tr><td>${r.position??'—'}</td><td>${esc(r.driverName)}</td><td>${r.score??TBC}</td><td>${esc(r.level)}</td><td>${r.races}</td></tr>`).join('')}</tbody></table></section>`;
    res.send(shell({title:'Classement GLOBAL Discord — GDSP',description:'Classement global GDSP sur 100',canonical:`${siteUrl}/global`,body}));
  }catch{ return unavailable(res); } });
  return app;
}
module.exports={createFrontendApp,shell,esc};
