'use strict';
const express=require('express');
const {MemoryStore,seedEvents}=require('./lib/store');
const {computeStandings}=require('./lib/standings');
const {computeGlobalRatings}=require('./lib/globalRating');
const {importPayloads}=require('./lib/importResult');
const {checkCredentials,issueToken,requireAdmin}=require('./lib/auth');
const {anonymize,assertNoGuid}=require('./lib/anonymize');
const {buildCircuitRound}=require('./lib/circuit');
const {listDriveFolder,pickCircuitFiles,downloadUrl,fetchBuffer,fetchText}=require('../tools/lib/drive');
const {scanServer}=require('./lib/ahServers');
const EVENT_KINDS=['championship','archive','open'];
function blankData(){ return {sessions:[],penMap:{},manualDrivers:{},customCalendar:{},eventInfo:{},posterImage:null,galleryImages:[],circuitRounds:[],serversAH:[]}; }
function validateEvent(body){
  if(!body||!/^[a-z0-9-]+$/.test(body.slug||'')) throw Object.assign(new Error('slug invalide (a-z, 0-9, -)'),{status:400});
  if(!EVENT_KINDS.includes(body.kind)) throw Object.assign(new Error('kind invalide'),{status:400});
  if(!body.name) throw Object.assign(new Error('name requis'),{status:400});
  return {slug:body.slug,name:body.name,kind:body.kind,points_config:body.points_config||body.pointsConfig||undefined,
    data:{...blankData(),...(body.data||{})}};
}
function createApp(store=new MemoryStore(seedEvents()), opts={}){
  if(opts.fetchJson&&!opts.fetchText) opts={...opts, fetchText:async url=>{ const j=await opts.fetchJson(url); return typeof j==='string'?j:JSON.stringify(j); }};
  const app=express();
  app.use(express.json({limit:'25mb'}));
  app.get('/api/health',(req,res)=>res.json({ok:true,service:'gdsp-backend'}));
  app.get('/api/events',async(req,res,next)=>{ try{ const events=await store.listEvents();
    res.json(events.map(({slug,name,kind,points_config})=>({slug,name,kind,points_config}))); }catch(e){next(e);} });
  app.get('/api/events/:slug',async(req,res,next)=>{ try{ const e=await store.getEvent(req.params.slug);
    if(!e) return res.status(404).json({error:'Événement introuvable'}); assertNoGuid(e); res.json(e); }catch(e){next(e);} });
  app.get('/api/events/:slug/standings',async(req,res,next)=>{ try{ const e=await store.getEvent(req.params.slug);
    if(!e) return res.status(404).json({error:'Événement introuvable'}); res.json(computeStandings(e)); }catch(e){next(e);} });
  app.get('/api/events/:slug/drivers/:driverId',async(req,res,next)=>{ try{ const e=await store.getEvent(req.params.slug);
    if(!e) return res.status(404).json({error:'Événement introuvable'});
    const sessions=(e.data.sessions||[]).filter(s=>(s.results||[]).some(r=>r.driverId===req.params.driverId));
    if(!sessions.length) return res.status(404).json({error:'Pilote introuvable'});
    res.json({driverId:req.params.driverId, sessions}); }catch(e){next(e);} });
  app.get('/api/global',async(req,res,next)=>{ try{ const settings=store.getSettings?await store.getSettings():{globalExclusions:[]};
    res.json(computeGlobalRatings(await store.listEvents(),{excludedDriverIds:settings.globalExclusions||[]})); }catch(e){next(e);} });
  app.get('/api/stats',async(req,res,next)=>{ try{ const events=await store.listEvents();
    const drivers=new Set(); let races=0;
    for(const e of events) for(const s of e.data.sessions||[]){ if(s.type==='RACE') races++; for(const r of s.results||[]) drivers.add(r.driverId); }
    res.json({events:events.length, races, drivers:drivers.size}); }catch(e){next(e);} });
  // --- Admin (Bearer) ---
  app.post('/api/admin/login',(req,res)=>{ const {username,password}=req.body||{};
    if(!checkCredentials(username,password)) return res.status(401).json({error:'Identifiants invalides'});
    res.json({token:issueToken(username)}); });
  app.post('/api/admin/events',requireAdmin,async(req,res,next)=>{ try{ const e=validateEvent(anonymize(req.body));
    await store.saveEvent(e); res.status(201).json(e); }catch(e){next(e);} });
  app.put('/api/admin/events/:slug',requireAdmin,async(req,res,next)=>{ try{
    const current=await store.getEvent(req.params.slug); if(!current) return res.status(404).json({error:'Événement introuvable'});
    const updated={...current,...anonymize(req.body),slug:current.slug,data:{...blankData(),...(req.body.data||current.data)}};
    await store.saveEvent(updated); res.json(updated); }catch(e){next(e);} });
  app.delete('/api/admin/events/:slug',requireAdmin,async(req,res,next)=>{ try{ await store.deleteEvent(req.params.slug); res.status(204).end(); }catch(e){next(e);} });
  app.post('/api/admin/events/:slug/import',requireAdmin,async(req,res,next)=>{ try{
    const e=await store.getEvent(req.params.slug); if(!e) return res.status(404).json({error:'Événement introuvable'});
    const payloads=req.body.payloads||req.body.payload||req.body;
    const result=importPayloads(e.data.sessions||[], payloads);
    e.data.sessions=result.sessions; await store.saveEvent(e);
    res.json({added:result.added.length, duplicates:result.duplicates.length}); }catch(e){next(e);} });
  app.post('/api/admin/events/:slug/import/assettohosting',requireAdmin,async(req,res,next)=>{ try{
    const e=await store.getEvent(req.params.slug); if(!e) return res.status(404).json({error:'Événement introuvable'});
    const servers=req.body.servers||[]; let all=[];
    for(const s of servers) all=all.concat(await scanServer(s, opts));
    const result=importPayloads(e.data.sessions||[], all); e.data.sessions=result.sessions; await store.saveEvent(e);
    res.json({scanned:all.length, added:result.added.length, duplicates:result.duplicates.length}); }catch(e){next(e);} });
  app.post('/api/admin/events/:slug/penalties',requireAdmin,async(req,res,next)=>{ try{
    const e=await store.getEvent(req.params.slug); if(!e) return res.status(404).json({error:'Événement introuvable'});
    const {sessionKey,driverId,seconds}=req.body||{}; // Commission penalty -> results re-rank automatically via standings/penMap
    e.data.penMap=e.data.penMap||{}; e.data.penMap[sessionKey]=[...(e.data.penMap[sessionKey]||[]),{driverId,seconds:Number(seconds)||0}];
    await store.saveEvent(e); res.json({penMap:e.data.penMap}); }catch(e){next(e);} });
  app.post('/api/admin/events/:slug/circuits/drive/preview',requireAdmin,async(req,res,next)=>{ try{
    const files=await listDriveFolder(req.body.folderUrl, opts.fetchFn);
    const picked=pickCircuitFiles(files);
    const fastLaneBuffer=await fetchBuffer(downloadUrl(picked.fastLane.id), opts.fetchFn);
    const get=async(f)=>f?await fetchText(downloadUrl(f.id), opts.fetchFn):null;
    const round=buildCircuitRound({roundId:req.body.roundId||'M1',label:req.body.label,
      fastLaneBuffer, surfacesText:await get(picked.surfaces), overlaysText:await get(picked.overlays), uiTrackText:await get(picked.uiTrack)});
    res.json(round); }catch(e){ e.status=e.status||400; next(e);} });
  app.post('/api/admin/events/:slug/circuits',requireAdmin,async(req,res,next)=>{ try{
    const e=await store.getEvent(req.params.slug); if(!e) return res.status(404).json({error:'Événement introuvable'});
    e.data.circuitRounds=[...(e.data.circuitRounds||[]).filter(r=>r.id!==req.body.id), req.body];
    await store.saveEvent(e); res.status(201).json(req.body); }catch(e){next(e);} });
  // --- Admin: rounds (Manches), drivers, servers, global exclusions ---
  app.delete('/api/admin/events/:slug/circuits/:roundId',requireAdmin,async(req,res,next)=>{ try{
    const e=await store.getEvent(req.params.slug); if(!e) return res.status(404).json({error:'Événement introuvable'});
    e.data.circuitRounds=(e.data.circuitRounds||[]).filter(r=>r.id!==req.params.roundId);
    await store.saveEvent(e); res.status(204).end(); }catch(e){next(e);} });
  app.put('/api/admin/events/:slug/drivers',requireAdmin,async(req,res,next)=>{ try{
    const e=await store.getEvent(req.params.slug); if(!e) return res.status(404).json({error:'Événement introuvable'});
    e.data.manualDrivers=anonymize(req.body.manualDrivers||{});
    await store.saveEvent(e); res.json({manualDrivers:e.data.manualDrivers}); }catch(e){next(e);} });
  app.delete('/api/admin/events/:slug/penalties',requireAdmin,async(req,res,next)=>{ try{
    const e=await store.getEvent(req.params.slug); if(!e) return res.status(404).json({error:'Événement introuvable'});
    const {sessionKey,driverId}=req.body||{};
    if(e.data.penMap&&e.data.penMap[sessionKey]) e.data.penMap[sessionKey]=e.data.penMap[sessionKey].filter(p=>p.driverId!==driverId);
    await store.saveEvent(e); res.json({penMap:e.data.penMap}); }catch(e){next(e);} });
  app.put('/api/admin/events/:slug/servers',requireAdmin,async(req,res,next)=>{ try{
    const e=await store.getEvent(req.params.slug); if(!e) return res.status(404).json({error:'Événement introuvable'});
    e.data.serversAH=Array.isArray(req.body.servers)?req.body.servers:[];
    await store.saveEvent(e); res.json({serversAH:e.data.serversAH}); }catch(e){next(e);} });
  app.post('/api/admin/events/:slug/servers/scan',requireAdmin,async(req,res,next)=>{ try{
    const e=await store.getEvent(req.params.slug); if(!e) return res.status(404).json({error:'Événement introuvable'});
    const servers=req.body.servers||e.data.serversAH||[]; let all=[];
    for(const s of servers) all=all.concat(await scanServer(s, opts));
    const result=importPayloads(e.data.sessions||[], all); e.data.sessions=result.sessions; await store.saveEvent(e);
    res.json({scanned:all.length, added:result.added.length, duplicates:result.duplicates.length}); }catch(e){next(e);} });
  app.get('/api/admin/global/exclusions',requireAdmin,async(req,res,next)=>{ try{
    res.json(store.getSettings?await store.getSettings():{globalExclusions:[]}); }catch(e){next(e);} });
  app.put('/api/admin/global/exclusions',requireAdmin,async(req,res,next)=>{ try{
    const settings={globalExclusions:Array.isArray(req.body.globalExclusions)?req.body.globalExclusions:[]};
    if(store.saveSettings) await store.saveSettings(settings);
    res.json(settings); }catch(e){next(e);} });
  app.use((err,req,res,next)=>{ res.status(err.status||500).json({error:err.message||'Erreur interne'}); }); // eslint-disable-line
  return app;
}
module.exports={createApp,validateEvent,blankData};
