'use strict';
const {createApp}=require('./app');
const {createStore}=require('./lib/store');
(async()=>{
  const store=createStore();
  if(store.ensureSchema) await store.ensureSchema();
  const port=process.env.PORT||4000;
  createApp(store).listen(port,'0.0.0.0',()=>console.log(`GDSP backend sur :${port}`));
})().catch(e=>{ console.error(e); process.exit(1); });
