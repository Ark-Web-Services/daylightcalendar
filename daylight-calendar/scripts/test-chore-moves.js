'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

async function main() {
 const data = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-chore-moves-'));
 const probe = http.createServer().listen(0, '127.0.0.1');
 await once(probe, 'listening'); const port = probe.address().port;
 await new Promise(resolve => probe.close(resolve));
 const options = path.join(data, 'options.json');fs.writeFileSync(options, '{}');
 const env = { ...process.env, STANDALONE_DEV:'true', PORT:String(port), DAYLIGHT_DATA_DIR:data,
  DAYLIGHT_OPTIONS_PATH:options, HASS_TOKEN:'test-only', HASS_API_URL:'http://127.0.0.1:1/api' };
 delete env.SUPERVISOR_TOKEN;
 const child = spawn(process.execPath, [path.resolve(__dirname, '../index.js')], { env, stdio:['ignore','pipe','pipe'] });
 let logs='';child.stdout.on('data',c=>{logs+=c});child.stderr.on('data',c=>{logs+=c});
 async function request(route,method='GET',body,status=200){
  const r=await fetch(`http://127.0.0.1:${port}/api/${route}`,{method,headers:{'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
  const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;
 }
 try {
  const deadline=Date.now()+10000;
  while(!logs.includes('Server running on port')){
   if(child.exitCode!==null||Date.now()>deadline)throw Error(logs);
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  const created=await request('chores','POST',{item:'Board movement test',starValue:3});
  const uid=created.uid; const move=(body,status)=>request(`chores/${uid}/move`,'POST',body,status);
  const read=async()=> (await request('chores')).items.find(item=>item.uid===uid);
  assert.equal((await read()).upForGrabs,true);
  await move({lane:'needs_action'},400);
  await move({lane:'needs_action',assignedProfileIds:['unknown']},400);
  await move({lane:'invalid'},400);
  await request('chores/missing/move','POST',{lane:'completed'},404);
  console.log('PASS unassigned defaults and invalid movements');
  await move({lane:'needs_action',assignedProfileIds:['u_riley'],expectedLane:'up-for-grabs'});
  assert.deepEqual((await read()).assignedProfileIds,['u_riley']);assert.equal((await read()).upForGrabs,false);
  await move({lane:'needs_action',assignedProfileIds:['u_sam'],expectedLane:'up-for-grabs'},409);
  await move({lane:'needs_action',assignedProfileIds:['u_sam'],expectedLane:'needs_action'});
  assert.deepEqual((await read()).assignedProfileIds,['u_sam']);assert.equal((await read()).starValue,3);
  console.log('PASS assign, reassign, stale board conflict, and metadata preservation');
  const ledgerBefore=(await request('stars')).entries.length;
  await move({lane:'completed',expectedLane:'needs_action'});
  assert.equal((await read()).status,'completed');
  const awarded=(await request('stars')).entries.slice(ledgerBefore);
  assert.equal(awarded.length,1);assert.equal(awarded[0].profileId,'u_sam');assert.equal(awarded[0].delta,3);
  await move({lane:'completed',expectedLane:'completed'});
  assert.equal((await request('stars')).entries.length,ledgerBefore+1);
  await move({lane:'up-for-grabs',expectedLane:'completed'});
  assert.equal((await read()).status,'needs_action');assert.deepEqual((await read()).assignedProfileIds,[]);
  assert.equal((await read()).upForGrabs,true);
  console.log('PASS complete with one star award and return from Done to Up for Grabs');
  const concurrent=await Promise.all([
   fetch(`http://127.0.0.1:${port}/api/chores/${uid}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lane:'needs_action',expectedLane:'up-for-grabs',assignedProfileIds:['u_riley']})}),
   fetch(`http://127.0.0.1:${port}/api/chores/${uid}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lane:'needs_action',expectedLane:'up-for-grabs',assignedProfileIds:['u_sam']})})
  ]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const stored=JSON.parse(fs.readFileSync(path.join(data,'chore_meta.json'),'utf8'));
  assert.equal(stored[uid].assignedProfileIds.length,1);
  console.log('PASS concurrent assignments have one winner and persist to storage');
 } finally {
  if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}
  fs.rmSync(data,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
