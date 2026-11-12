'use strict';
const express=require('express');
const {createApp}=require('./backend/app');
const {createFrontendApp}=require('./frontend/app');
const {createStore,seedIfEmpty}=require('./backend/lib/store');

/** One Render service: API, SSR pages, static assets and admin share the same process. */
function createUnifiedApp(store){
  const app=express();
  app.use(createApp(store));
  app.use(createFrontendApp({proxy:false}));
  return app;
}

async function start(){
  const store=createStore();
  if(store.ensureSchema) await store.ensureSchema();
  if(await seedIfEmpty(store)) console.log('Base vide : événement de démonstration créé');
  const port=Number(process.env.PORT)||3000;
  // SSR uses the public API through loopback. This URL is server-side only and never reaches the browser.
  process.env.BACKEND_URL=`http://127.0.0.1:${port}`;
  const server=createUnifiedApp(store).listen(port,'0.0.0.0',()=>console.log(`GDSP unifié sur :${port}`));
  return server;
}

if(require.main===module) start().catch(e=>{ console.error(e); process.exit(1); });
module.exports={createUnifiedApp,start};
