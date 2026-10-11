import path from 'node:path';
import crypto from 'node:crypto';
import {stateRoot} from './core.mjs';
import {invoke,fail,uid,create,REGIONS,validateLayout,matchesBatch,appendRun} from './workflow.mjs';

const labels=['主图区','主图视频区','SKU区','详情页区'];
const geometry=e=>Object.fromEntries(['x','y','width','height'].map(k=>[k,e[k]]));
const reject=message=>fail('CANVAS_STATE_UNSUPPORTED',message+' Use a completed --base-run when available. Existing canvas content was preserved.');

// Discovery is read-only; service keyword search is fuzzy, application selection is exact.
export async function findCanvases(title,call=invoke){
  if(typeof title!=='string'||!title.trim())fail('INVALID_INPUT','Provide an exact canvas title.');
  const found=new Map();let page=1;
  for(;;){
    const result=await call('sealseek-media',['canvas','list','--keyword',title,'--page',String(page),'--limit','100','--json']);
    if(!Array.isArray(result.canvases))fail('OUTPUT_CONTRACT_FAILED','Invalid canvas list.');
    for(const b of result.canvases)if(b.title===title)found.set(String(b.canvas_id),b);
    const pages=Number(result.pages??1);
    if(!Number.isInteger(pages)||pages<0||pages>10000)fail('OUTPUT_CONTRACT_FAILED','Invalid canvas pagination.');
    if(page>=pages)break;page++;
  }
  return {title,count:found.size,canvases:[...found.values()]};
}

export async function selectCanvas({title,canvas},call=invoke){
  let id=canvas;
  if(title&&!canvas){
    const result=await findCanvases(title,call);
    if(!result.count)fail('CANVAS_NOT_FOUND','No canvas has this exact title.');
    if(result.count>1)throw Object.assign(new Error('Multiple canvases have this title; select a canvas ID.'),{code:'AMBIGUOUS_CANVAS',details:result});
    id=result.canvases[0].canvas_id;
  }
  if(!/^\d+$/.test(id||''))fail('INVALID_INPUT','Provide --title TEXT or --canvas ID.');
  const board=await call('sealseek-media',['canvas','get',String(id),'--json']);
  if(String(board.canvas_id)!==String(id))fail('OUTPUT_CONTRACT_FAILED','Canvas identity mismatch.');
  if(title&&board.title!==title)fail('CANVAS_CHANGED','Selected canvas title differs.');
  return board;
}

// The application reconstructs only its own four-region contract. No provider API is duplicated.
// Frame hashes bind even empty video Frames to their product, category and collection run.
export function restoreCanvas(board,run_id=crypto.randomUUID()){
  if(!board.canvas_id||!Array.isArray(board.elements))reject('Canvas content is unavailable.');
  const elements=board.elements.filter(e=>!e.isDeleted),images=elements.filter(e=>e.type==='image');
  const texts=labels.map(text=>{const found=elements.filter(e=>e.type==='text'&&e.text===text&&typeof e.id==='string'&&e.id.startsWith('region-'));if(found.length!==1)reject('Four unique region headings are required.');const e=found[0];if(!['x','y','width','height','fontSize'].every(k=>Number.isFinite(e[k]))||e.width<=0||e.height<=0||e.fontSize<8||e.fontSize>200)reject('Invalid heading geometry.');return {id:e.id,text,...geometry(e),fontSize:e.fontSize};});
  if(texts.some((t,i)=>i&&t.x<=texts[i-1].x))reject('Unsupported region order.');
  const products=new Map(),identities=new Map(),media=[],taskIds=new Set();
  for(const e of images){
    const s=e.customData?.sourceMetadata,task=e.customData?.cliTaskId;
    if(!s||!REGIONS.includes(s.category)||!/^\d+$/.test(s.productId||'')||typeof s.assetId!=='string'||typeof task!=='string'||e.customData.cliOutputIndex!==0)reject('An image lacks application source metadata.');
    const suffix='-'+s.assetId+'-'+s.category;
    if(!task.endsWith(suffix))reject('Invalid application media identity.');
    if(taskIds.has(task))reject('Duplicate application media identity.');taskIds.add(task);
    const origin=task.slice(0,-suffix.length),key=origin+'|'+s.productId;
    if(!origin)reject('Missing collection identity.');
    if(!products.has(s.productId))products.set(s.productId,{id:s.productId,title:'商品 '+s.productId,url:s.sourceUrl,shop:{shopId:s.shopId,shopName:''},coverage:{recovered_from_canvas:true,original_collection:'unavailable'},assets:Object.fromEntries(REGIONS.map(c=>[c,[]]))});
    identities.set(key,{origin,productId:s.productId});
    const kind=s.category==='main_videos'?'video':'image',url=kind==='video'?e.customData.videoUrl:e.customData.fileUrl;
    if(!url||(kind==='video'&&!e.customData.fileUrl)||!['x','y','width','height'].every(k=>Number.isFinite(e[k]))||e.width<=0||e.height<=0)reject('Invalid media geometry or URL.');
    media.push({id:task,kind,urls:[url],frameId:e.frameId,placement:{mode:'explicit',positions:[geometry(e)]},...(kind==='video'?{posterUrl:e.customData.fileUrl}:{}),sourceMetadata:structuredClone(s)});
    products.get(s.productId).assets[s.category].push({asset_id:s.assetId,kind,url,width:e.width,height:e.height,recovered:true,source_index:0});
  }
  if(!products.size)reject('No recoverable products were found.');
  const frames=[],members=new Map(REGIONS.map(c=>[c,[]])),frameKeys=new Set();
  for(const e of elements.filter(e=>e.type==='frame')){
    const candidates=[];
    for(const v of identities.values())for(const category of REGIONS)if(e.id==='frame-'+uid([v.origin,v.productId,category]))candidates.push({...v,category});
    if(candidates.length!==1)reject('A Frame cannot be bound to an application product.');
    const identity=candidates[0],p=products.get(identity.productId);
    const key=identity.productId+'|'+identity.category;
    if(frameKeys.has(key)||typeof e.name!=='string'||!e.name.trim()||!['x','y','width','height'].every(k=>Number.isFinite(e[k]))||e.width<=0||e.height<=0)reject('Duplicate Frame identity or invalid geometry.');
    frameKeys.add(key);
    if(p.shop.shopName&&p.shop.shopName!==e.name)reject('Product shop names differ across Frames.');
    p.shop.shopName=e.name;
    const frame={id:e.id,name:e.name,...geometry(e)};frames.push(frame);members.get(identity.category).push(frame);
    for(const m of media.filter(m=>m.frameId===e.id))if(m.sourceMetadata.productId!==identity.productId||m.sourceMetadata.category!==identity.category)reject('Media source and Frame identity disagree.');
  }
  if(frames.length!==products.size*4||REGIONS.some(c=>members.get(c).length!==products.size)||media.some(m=>!frames.some(f=>f.id===m.frameId)))reject('Product Frames are incomplete.');
  const known=new Set([...frames,...texts].map(e=>e.id));
  if(elements.some(e=>!known.has(e.id)&&e.type!=='image'&&!(e.type==='rectangle'&&e.customData?.type==='frame-background'&&frames.some(f=>f.id===e.customData.ownerFrameId))))reject('The canvas contains unsupported elements.');
  const regions=REGIONS.map((category,i)=>{
    const list=members.get(category),horizontal=category==='detail_images',x=texts[i].x,y=Math.min(...list.map(f=>f.y));
    list.sort((a,b)=>horizontal?a.x-b.x:a.y-b.y);
    if(list.some(f=>horizontal?f.y!==y:f.x!==x)||list[0].x!==x)reject('Unsupported Frame alignment.');
    const width=horizontal?Math.max(...list.map(f=>f.width)):texts[i+1].x-x-240;
    if(list.some(f=>!horizontal&&f.width>width)||width<=0)reject('Unsupported region bounds.');
    const bottom=Math.max(...list.map(f=>f.y+f.height)),right=Math.max(...list.map(f=>f.x+f.width));
    return {category,x,y,width,axis:horizontal?'horizontal':'vertical',next_x:horizontal?right+96:x,next_y:horizontal?y:bottom+96,bottom,right,frame_ids:list.map(f=>f.id)};
  });
  const plan={schema_version:2,presentation_version:1,run_id,title:board.title,layout_options:{width:320,gap:32,padding:32,frameGap:96,regionGap:240},regions,batch:{frames,media,texts},recovered_from_canvas:String(board.canvas_id)};
  validateLayout(plan);
  if(!matchesBatch(board,plan.batch))reject('Recovered canvas does not match its source content.');
  return {plan,manifest:{schema_version:1,run_id,captured_at:new Date().toISOString(),recovered_from_canvas:String(board.canvas_id),products:[...products.values()]}};
}

export async function appendToCanvas(run,selector,inputs,rawFiles=[],call=invoke){
  const board=await selectCanvas(selector,call),{plan,manifest}=restoreCanvas(board);
  const base=path.join(stateRoot(),'recovered-canvases',plan.run_id);
  await create(path.join(base,'layout.plan.json'),plan);
  await create(path.join(base,'canvas.batch.json'),plan.batch);
  await create(path.join(base,'assets.manifest.json'),manifest);
  await create(path.join(base,'canvas.state.json'),{run_id:plan.run_id,status:'completed',canvas_id:String(board.canvas_id),canvas_url:board.canvas_url});
  return {...await appendRun(run,base,inputs,rawFiles),canvas_id:String(board.canvas_id),title:board.title,recovered_base_run:base};
}
