'use strict';
const {createFrontendApp}=require('./app');
const port=process.env.PORT||3000;
createFrontendApp().listen(port,'0.0.0.0',()=>console.log(`GDSP frontend sur :${port} (backend: ${process.env.BACKEND_URL||'http://localhost:4000'})`));
