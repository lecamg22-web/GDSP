'use strict';
/**
 * Persistence port. Default: in-memory (tests, local dev).
 * Production (Render/Neon): PostgresStore talks to Neon's HTTP SQL endpoint
 * with node:https only — no pg driver, keeping express as sole dependency.
 * The frontend NEVER talks to this layer; only the backend REST API does.
 */
const https=require('node:https');
class MemoryStore{
  constructor(events=[]){ this.events=new Map(events.map(e=>[e.slug,structuredClone(e)])); this.settings={globalExclusions:[]}; }
  async getSettings(){ return structuredClone(this.settings); }
  async saveSettings(s){ this.settings={globalExclusions:[...(s.globalExclusions||[])]}; return this.getSettings(); }
  async listEvents(){ return [...this.events.values()].map(e=>structuredClone(e)); }
  async getEvent(slug){ const e=this.events.get(slug); return e?structuredClone(e):null; }
  async saveEvent(event){ this.events.set(event.slug,structuredClone(event)); return structuredClone(event); }
  async deleteEvent(slug){ return this.events.delete(slug); }
}
function neonSqlEndpoint(databaseUrl){
  const u=new URL(databaseUrl); return `https://${u.hostname}/sql`;
}
/** Minimal Neon HTTP client: POST {query, params} to https://<host>/sql (Neon serverless driver protocol). */
function neonQuery(databaseUrl, apiKey){
  return (query, params=[])=>new Promise((resolve,reject)=>{
    const body=JSON.stringify({query,params});
    const req=https.request(neonSqlEndpoint(databaseUrl),{method:'POST',headers:{
      'Content-Type':'application/json','Neon-Connection-String':databaseUrl,
      ...(apiKey?{Authorization:`Bearer ${apiKey}`}:{}),'Content-Length':Buffer.byteLength(body)}},res=>{
      let data=''; res.on('data',c=>data+=c); res.on('end',()=>{
        if(res.statusCode>=300) return reject(new Error(`Neon HTTP ${res.statusCode}: ${data.slice(0,200)}`));
        try{ resolve(JSON.parse(data)); }catch(e){ reject(e); } });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}
class PostgresStore{
  constructor(databaseUrl, apiKey=process.env.NEON_API_KEY){ this.query=neonQuery(databaseUrl,apiKey); }
  async ensureSchema(){ await this.query(`CREATE TABLE IF NOT EXISTS events (slug TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, payload JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`);
    await this.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, payload JSONB NOT NULL)`); }
  async getSettings(){ try{ const r=await this.query(`SELECT payload FROM settings WHERE key='global'`); const row=(r.rows||[])[0];
    return row?(typeof row.payload==='string'?JSON.parse(row.payload):row.payload):{globalExclusions:[]}; }catch{ return {globalExclusions:[]}; } }
  async saveSettings(s){ const v={globalExclusions:[...(s.globalExclusions||[])]};
    await this.query(`INSERT INTO settings(key,payload) VALUES('global',$1) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload`,[JSON.stringify(v)]); return v; }
  async listEvents(){ const r=await this.query(`SELECT payload FROM events ORDER BY name`); return (r.rows||[]).map(row=>typeof row.payload==='string'?JSON.parse(row.payload):row.payload); }
  async getEvent(slug){ const r=await this.query(`SELECT payload FROM events WHERE slug=$1`,[slug]); const row=(r.rows||[])[0]; return row?(typeof row.payload==='string'?JSON.parse(row.payload):row.payload):null; }
  async saveEvent(event){ await this.query(`INSERT INTO events(slug,kind,name,payload) VALUES($1,$2,$3,$4) ON CONFLICT(slug) DO UPDATE SET kind=EXCLUDED.kind,name=EXCLUDED.name,payload=EXCLUDED.payload,updated_at=now()`,
    [event.slug,event.kind,event.name,JSON.stringify(event)]); return event; }
  async deleteEvent(slug){ await this.query(`DELETE FROM events WHERE slug=$1`,[slug]); return true; }
}
function createStore(){
  if(process.env.DATABASE_URL) return new PostgresStore(process.env.DATABASE_URL);
  return new MemoryStore(seedEvents());
}
const {defaultServers}=(()=>{ try{ return require('./ahServers'); }catch{ return {defaultServers:()=>[]}; } })();
function seedEvents(){
  return [{ slug:'championnat-exemple', name:'Championnat Exemple', kind:'championship',
    points_config:{scale:[25,18,15,12,10,8,6,4,2,1],polePoints:1,coefficient:1,jokers:1,minDistancePercent:75},
    data:{sessions:[],pendingSessions:[],penMap:{},manualDrivers:{},customCalendar:{},eventInfo:{description:'Événement de démonstration — à confirmer'},posterImage:null,galleryImages:[],circuitRounds:[],serversAH:defaultServers()} }];
}
/** Initialise une base vide sans jamais écraser les événements existants. */
async function seedIfEmpty(store){
  if((await store.listEvents()).length) return false;
  for(const event of seedEvents()) await store.saveEvent(event);
  return true;
}
module.exports={MemoryStore,PostgresStore,createStore,neonSqlEndpoint,seedEvents,seedIfEmpty};
