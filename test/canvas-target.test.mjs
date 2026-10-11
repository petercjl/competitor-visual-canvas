import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {layout,matchesBatch} from '../src/workflow.mjs';
import {findCanvases,selectCanvas,restoreCanvas} from '../src/canvas-target.mjs';

const p=id=>({id,title:'Product '+id,url:'https://item.taobao.com/item.htm?id='+id,shop:{shopName:'Shop',shopId:'1'},assets:{main_images:[{asset_id:'asset'+id,kind:'image',url:'https://example.com/'+id,width:100,height:100}],main_videos:[],sku_images:[],detail_images:[]}});
const live=plan=>({canvas_id:'123',title:'My canvas',canvas_url:'https://example.com/123',elements:[...plan.batch.frames.map(f=>({...f,type:'frame'})),...plan.batch.texts.map(t=>({...t,type:'text'})),...plan.batch.media.map((m,i)=>({id:'image'+i,type:'image',frameId:m.frameId,...m.placement.positions[0],customData:{cliTaskId:m.id,cliOutputIndex:0,sourceMetadata:m.sourceMetadata,fileUrl:m.urls[0]}}))]});

test('exact title lookup paginates, deduplicates, and never chooses a fuzzy match',async()=>{
 const calls=[];const result=await findCanvases('My canvas',async(_,args)=>{calls.push(args);return {pages:2,canvases:args.includes('1')?[{canvas_id:'1',title:'My canvas'},{canvas_id:'2',title:'My canvas copy'}]:[{canvas_id:'1',title:'My canvas'},{canvas_id:'3',title:'My canvas'}]};});
 assert.equal(calls.length,2);assert.deepEqual(result.canvases.map(b=>b.canvas_id),['1','3']);
 await assert.rejects(selectCanvas({title:'My canvas'},async()=>({pages:1,canvases:result.canvases})),e=>e.code==='AMBIGUOUS_CANVAS'&&e.details.canvases.length===2);
 await assert.rejects(selectCanvas({title:'missing'},async()=>({pages:1,canvases:[]})),{code:'CANVAS_NOT_FOUND'});
 const board={canvas_id:'3',title:'My canvas'};assert.deepEqual(await selectCanvas({title:'My canvas',canvas:'3'},async()=>board),board);
 await assert.rejects(selectCanvas({title:'different',canvas:'3'},async()=>board),{code:'CANVAS_CHANGED'});
});

test('cloud recovery binds empty Frames and preserves geometry without a local run',()=>{
 const base=layout({run_id:'first',products:[p('1'),p('2')]});
 const board=live(base);board.elements.push({id:'bg',type:'rectangle',customData:{type:'frame-background',ownerFrameId:base.batch.frames[0].id}});
 const recovered=restoreCanvas(board,'recovered');assert(matchesBatch(board,recovered.plan.batch));assert.equal(recovered.manifest.products.length,2);
 const next=layout({run_id:'next',products:[p('3')]},{basePlan:recovered.plan});
 assert.deepEqual(next.batch.frames.slice(0,8),recovered.plan.batch.frames);assert.deepEqual(next.batch.media.slice(0,2),recovered.plan.batch.media);
 for(const r of recovered.plan.regions){const n=next.regions.find(n=>n.category===r.category);assert.equal(n.x,r.x);assert.equal(n.frame_ids.length,3);}
 const bad=structuredClone(board);delete bad.elements.find(e=>e.type==='image').customData.sourceMetadata;
 assert.throws(()=>restoreCanvas(bad),{code:'CANVAS_STATE_UNSUPPORTED'});
 const mixed=structuredClone(board);mixed.elements.push({id:'extra',type:'text',text:'notes'});assert.throws(()=>restoreCanvas(mixed),{code:'CANVAS_STATE_UNSUPPORTED'});
 const incomplete=structuredClone(board);incomplete.elements=incomplete.elements.filter(e=>e.id!==base.batch.frames[2].id);assert.throws(()=>restoreCanvas(incomplete),{code:'CANVAS_STATE_UNSUPPORTED'});
});

test('cloud video recovery retains actual video URL and poster separately',()=>{
 const product=p('1');product.assets.main_videos=[{asset_id:'video1',kind:'video',url:'https://example.com/video.mp4',width:1920,height:1080}];
 const plan=layout({run_id:'video-run',products:[product]});const board=live(plan),m=plan.batch.media.find(m=>m.kind==='video'),e=board.elements.find(e=>e.customData?.cliTaskId===m.id);
 e.customData.videoUrl=m.urls[0];e.customData.fileUrl='https://example.com/poster.jpg';
 const r=restoreCanvas(board);const video=r.plan.batch.media.find(m=>m.kind==='video');assert.equal(video.urls[0],'https://example.com/video.mp4');assert.equal(video.posterUrl,'https://example.com/poster.jpg');assert(matchesBatch(board,r.plan.batch));
});

test('real CLI entry finds, restores, plans and writes through dependency contract; duplicate append is read-only',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-name-'));
 try{
  const boardPath=path.join(root,'board.json'),entry=path.join(root,'mock.mjs'),log=path.join(root,'calls.jsonl');
  const board=live(layout({run_id:'base',products:[p('1')]}));await fs.writeFile(boardPath,JSON.stringify(board),{flag:'wx'});
  await fs.writeFile(entry,`import fs from 'node:fs';const a=process.argv.slice(2),file=${JSON.stringify(boardPath)},b=JSON.parse(fs.readFileSync(file));fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');let r;
if(a[0]==='canvas'&&a[1]==='list')r={pages:1,canvases:[{canvas_id:b.canvas_id,title:b.title}]};
else if(a[0]==='canvas'&&a[1]==='get')r=b;
else if(a[0]==='media'&&a[1]==='inspect')r={width:100,height:100};
else if(a[0]==='canvas'&&a[1]==='batch'){
 if(a[2]==='preview')r={valid:true};else {const batch=JSON.parse(fs.readFileSync(a[a.indexOf('--file')+1]));const old=new Set(b.elements.map(e=>e.id));for(const f of batch.frames)if(!old.has(f.id))b.elements.push({...f,type:'frame'});for(const t of batch.texts)if(!old.has(t.id))b.elements.push({...t,type:'text'});for(const m of batch.media)if(!b.elements.some(e=>e.customData?.cliTaskId===m.id))b.elements.push({id:m.id,type:'image',frameId:m.frameId,...m.placement.positions[0],customData:{cliTaskId:m.id,cliOutputIndex:0,fileUrl:m.urls[0],sourceMetadata:m.sourceMetadata}});fs.writeFileSync(file,JSON.stringify(b));r={saved:true};}
}else throw Error('Unexpected dependency operation '+a.join(' '));console.log(JSON.stringify(r));`,{flag:'wx'});
  const cli=fileURLToPath(new URL('../bin/competitor-visual-canvas.mjs',import.meta.url));
  const call=(...args)=>{const r=spawnSync(process.execPath,[cli,...args,'--json'],{encoding:'utf8',env:{...process.env,COMPETITOR_CANVAS_AUTO_UPDATE:'0',COMPETITOR_CANVAS_STATE_DIR:path.join(root,'state'),SEALSEEK_MEDIA_ENTRY:entry}});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
  assert.equal(call('find','--title','My canvas').count,1);
  const raw=path.join(root,'raw.json');await fs.writeFile(raw,JSON.stringify({itemId:'2',detail:{itemId:'2',title:'New product',shop:{shopName:'Other shop'},mainImages:['https://example.com/new'],properties:[],skus:[]},mainVideos:{records:[]},description:{images:[]},coverage:{}}),{flag:'wx'});
  const run=path.join(root,'append');const result=call('append','--title','My canvas','--run',run,'--input','2','--raw',raw);
  assert.equal(result.canvas_id,'123');assert.equal(result.frames,8);
  const report=call('canvas','--run',run,'--submit');assert.equal(report.products.length,2);
  const after=JSON.parse(await fs.readFile(boardPath));assert.deepEqual(after.elements.slice(0,board.elements.length),board.elements);
  const duplicate=call('append','--canvas','123','--run',path.join(root,'duplicate'),'--input','1','--input','2');assert.equal(duplicate.changed,false);
  assert.equal(await fs.stat(path.join(root,'duplicate')).catch(()=>null),null);
  const calls=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert(!calls.some(a=>a[0]==='canvas'&&a[1]==='create'));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
