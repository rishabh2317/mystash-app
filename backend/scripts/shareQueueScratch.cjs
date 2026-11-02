/* Existing binaries/dependencies only. Uses a private Redis Unix socket, never REDIS_URL. */
/* global __dirname */
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const req=require('node:module').createRequire(path.join(__dirname,'../package.json'));
req('tsx/cjs');
const {retireTerminalJob}=require('../src/content-source/jobs/terminalJob.ts');
const {Queue,Worker}=req('bullmq');const Redis=req('ioredis');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mystash-share-redis-')),socket=path.join(directory,'redis.sock');
 const process=spawn('/opt/homebrew/bin/redis-server',['--port','0','--unixsocket',socket,'--unixsocketperm','700','--save','','--appendonly','no','--dir',directory],{stdio:['ignore','pipe','pipe']});
 let queue,worker,connection;
 try{
  const deadline=Date.now()+10000;while(!fs.existsSync(socket)){if(process.exitCode!==null||Date.now()>deadline)throw Error('Disposable Redis did not start');await new Promise(r=>setTimeout(r,20));}
  connection=new Redis({path:socket,maxRetriesPerRequest:null});await connection.ping();
  queue=new Queue('share-fixture',{connection});
  const failed=await queue.add('fixture',{}, {jobId:'retained'});
  worker=new Worker('share-fixture',async()=>{throw Error('fixture-failure');},{connection});
  await once(worker,'failed');await worker.close();worker=null;
  assert.equal(await failed.getState(),'failed');
  const duplicate=await queue.add('fixture',{}, {jobId:'retained'});
  assert.equal(duplicate.id,'retained');assert.equal(await duplicate.getState(),'failed');
  await retireTerminalJob(()=>queue.getJob('retained'));await queue.add('fixture',{}, {jobId:'retained'});
  assert.equal(await (await queue.getJob('retained')).getState(),'waiting');
  await retireTerminalJob(()=>queue.getJob('retained'));assert.equal(await (await queue.getJob('retained')).getState(),'waiting');
  let count=0;worker=new Worker('share-fixture',async()=>{count++;return 'done';},{connection});
  await once(worker,'completed');await worker.close();worker=null;assert.equal(count,1);
  await retireTerminalJob(()=>queue.getJob('retained'));assert.equal(await queue.getJob('retained'),undefined);
  console.log(JSON.stringify({passed:true,checks:['real BullMQ duplicate return','failed retry','waiting preservation','one consumer execution','completed retry']}));
 }finally{
  if(worker)await worker.close();if(queue)await queue.close();if(connection)await connection.quit();
  if(process.exitCode===null && process.signalCode===null){const exited=once(process,'exit');process.kill('SIGTERM');await exited;}
  fs.rmSync(directory,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e.message);global.process.exitCode=1;});
