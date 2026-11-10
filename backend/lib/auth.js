'use strict';
const crypto=require('node:crypto');
function secret(){ return process.env.ADMIN_PASSWORD||'dev-only-change-me'; }
function sign(payload){
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig=crypto.createHmac('sha256',secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function issueToken(username){
  if(!process.env.ADMIN_USERNAME||!process.env.ADMIN_PASSWORD) throw new Error('ADMIN_USERNAME/ADMIN_PASSWORD non configurés');
  return sign({sub:username, exp:Date.now()+12*3600*1000});
}
function verifyToken(token){
  if(!token||typeof token!=='string'||!token.includes('.')) return null;
  const [body,sig]=token.split('.');
  const expected=crypto.createHmac('sha256',secret()).update(body).digest('base64url');
  const a=Buffer.from(sig), b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) return null;
  try{ const p=JSON.parse(Buffer.from(body,'base64url').toString()); return p.exp>Date.now()?p:null; }catch{ return null; }
}
function checkCredentials(username,password){
  const u=process.env.ADMIN_USERNAME, p=process.env.ADMIN_PASSWORD;
  if(!u||!p) return false;
  const safe=(a,b)=>{ const x=Buffer.from(String(a)),y=Buffer.from(String(b)); return x.length===y.length&&crypto.timingSafeEqual(x,y); };
  return safe(username||'',u)&&safe(password||'',p);
}
function requireAdmin(req,res,next){
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!verifyToken(token)) return res.status(401).json({error:'Jeton administrateur invalide ou expiré'});
  next();
}
module.exports={issueToken,verifyToken,checkCredentials,requireAdmin};
