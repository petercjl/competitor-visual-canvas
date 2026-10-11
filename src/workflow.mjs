import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const dependencyRequire=createRequire(import.meta.url);
function bundledEntry(tool){try{const name=tool==='tbcli'?'@petercjl/tbcli':'@petercjl/sealseek-media-cli';const file=dependencyRequire.resolve(name+'/package.json');const pkg=dependencyRequire(name+'/package.json');return path.join(path.dirname(file),pkg.bin[tool]);}catch{return null;}}

export const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
export const uid=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
export const read=p=>fs.readFile(p,'utf8').then(JSON.parse);
export async function exists(p){try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
export async function create(p,v){if(await exists(p))fail('OUTPUT_EXISTS','Output exists: '+p);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});}
export async function checkpoint(p,v){if(await exists(p)){const old=await read(p);if(old.run_id!==v.run_id)fail('STATE_CONFLICT','Run state ownership mismatch.');const backup=p+'.'+crypto.randomUUID()+'.backup';await fs.copyFile(p,backup,fs.constants.COPYFILE_EXCL);if((await fs.stat(backup)).size!==(await fs.stat(p)).size)fail('BACKUP_FAILED','Backup failed.');await fs.writeFile(p,JSON.stringify(v,null,2)+'\n',{mode:0o600});}else await create(p,v);}
export const TOOLS_FILE=path.join(os.homedir(),'.config','competitor-visual-canvas','tools.json');
export async function configureTool(tool,entry){
  if(!['tbcli','sealseek-media'].includes(tool))fail('INVALID_INPUT','Unknown dependency.');
  if(!path.isAbsolute(entry)||!await exists(entry))fail('INVALID_INPUT','Entry must be an existing absolute CLI path.');
  const old=await exists(TOOLS_FILE)?await read(TOOLS_FILE):{run_id:'competitor-visual-canvas-tools',owner:'@petercjl/competitor-visual-canvas',entries:{}};
  if(old.owner!=='@petercjl/competitor-visual-canvas')fail('STATE_CONFLICT','User-owned tool configuration preserved.');
  old.entries[tool]=entry;await checkpoint(TOOLS_FILE,old);return {configured:true,tool,entry,configuration:TOOLS_FILE};
}
export async function invoke(tool,args){
  const cfg=await exists(TOOLS_FILE)?await read(TOOLS_FILE):null;
  const entry=process.env[tool==='tbcli'?'TBCLI_ENTRY':'SEALSEEK_MEDIA_ENTRY']||cfg?.entries?.[tool]||bundledEntry(tool)||tool;
  const node=/\.mjs$|\.js$/.test(entry),cmd=node?process.execPath:entry,argv=node?[entry,...args]:args;
  return new Promise((resolve,reject)=>{const child=spawn(cmd,argv,{env:{...process.env,TBCLI_UPDATE_CHECK:'0',SEALSEEK_MEDIA_AUTO_UPDATE:'0'},stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>child.kill(),180000);child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Object.assign(new Error(tool+' operation failed: '+(err||out).slice(-1200)),{code:'DEPENDENCY_FAILED'}));try{resolve(JSON.parse(out));}catch{reject(Object.assign(new Error(tool+' returned invalid JSON'),{code:'OUTPUT_CONTRACT_FAILED'}));}});});
}
export function normalizeInputs(inputs){
  const seen=new Set(),result=[];
  for(const input of inputs){let id,platform='taobao';if(/^\d{1,30}$/.test(input))id=input;else{let u;try{u=new URL(input);}catch{fail('INVALID_INPUT','Provide a product ID or Taobao/Tmall detail URL.');}if(!['item.taobao.com','detail.tmall.com','detail.tmall.hk'].includes(u.hostname))fail('FEATURE_UNSUPPORTED','Unsupported product URL; resolve share links with tbcli first.');id=u.searchParams.get('id');if(u.hostname!=='item.taobao.com')platform='tmall';}
    if(!/^\d{1,30}$/.test(id||''))fail('INVALID_INPUT','Invalid product ID.');if(seen.has(id))continue;seen.add(id);result.push({id,platform,input,url:`https://${platform==='taobao'?'item.taobao.com/item.htm':'detail.tmall.com/item.htm'}?id=${id}`});
  }if(!result.length)fail('INVALID_INPUT','Provide at least one product.');return result;
}
export function normalizeProduct(input,raw){
  const d=raw.detail;if(raw.itemId!==input.id||d?.itemId!==input.id)fail('ITEM_ID_MISMATCH','Collection identity mismatch.');if(!d.title||!d.shop?.shopName)fail('OUTPUT_CONTRACT_FAILED','Product title and shop name are required.');
  const make=(kind,values)=>{const seen=new Map();values.forEach((value,i)=>{const a=typeof value==='string'?{url:value}:value;if(!a?.url)return;const old=seen.get(a.url);if(old){if(a.skuOptions)old.skuOptions.push(...a.skuOptions);return;}seen.set(a.url,{...a,asset_id:uid([input.id,kind,a.url]),kind:kind==='main_videos'?'video':'image',source_index:i,...(a.skuOptions?{skuOptions:[...a.skuOptions]}:{})});});return [...seen.values()];};
  return {...input,title:d.title,shop:d.shop,coverage:raw.coverage,assets:{
    main_images:make('main_images',d.mainImages||[]),main_videos:make('main_videos',raw.mainVideos?.records||[]),
    detail_images:make('detail_images',raw.description?.images||[]),
    sku_images:make('sku_images',(d.properties||[]).flatMap(p=>p.values.filter(v=>v.imageUrl).map(v=>({url:v.imageUrl,skuOptions:[{pid:p.pid,property:p.name,vid:v.vid,name:v.name,skuIds:(d.skus||[]).filter(s=>s.options.some(o=>o.pid===p.pid&&o.vid===v.vid)).map(s=>s.skuId)}]}))))
  }};
}
export async function collect(run,inputs,rawFiles=[]){
  if(await exists(run))fail('OUTPUT_EXISTS','Choose a new run directory.');
  const products=normalizeInputs(inputs),run_id=crypto.randomUUID();await fs.mkdir(run,{recursive:true,mode:0o700});await create(path.join(run,'inputs.json'),{run_id,products});
  const manifest={schema_version:1,run_id,captured_at:new Date().toISOString(),products:[]};
  for(const input of products){
    let raw;if(rawFiles.length){for(const file of rawFiles){const r=await read(file);if(r.itemId===input.id){raw=r;break;}}if(!raw)fail('INPUT_MISSING','No raw collection for '+input.id);}else{const out=path.join(run,'raw',input.id+'.json');await fs.mkdir(path.dirname(out),{recursive:true});await invoke('tbcli',['item','media','--item-id',input.id,'--out',out,'--json']);raw=await read(out);}
    if(rawFiles.length)await create(path.join(run,'raw',input.id+'.json'),raw);
    manifest.products.push(normalizeProduct(input,raw));await checkpoint(path.join(run,'assets.manifest.json'),manifest);
  }return manifest;
}
export const REGIONS=['main_images','main_videos','sku_images','detail_images'];
export function layout(manifest,options={}){
  const base=options.basePlan;
  if(base&&(base.schema_version!==2||base.presentation_version!==1))fail('LAYOUT_MIGRATION_REQUIRED','Migrate the existing run with reflow before appending.');
  const {width=320,gap=32,padding=32,frameGap=96,regionGap=240}=base?.layout_options||options;
  if(![width,gap,padding,frameGap,regionGap].every(Number.isFinite)||width<=0||[gap,padding,frameGap,regionGap].some(x=>x<0))fail('INVALID_INPUT','Invalid layout dimensions.');
  const local={};
  for(const category of REGIONS){local[category]=[];
    for(const product of manifest.products){
      const id='frame-'+uid([manifest.run_id,product.id,category]),placements=[];let localX=padding,localY=padding,maxX=padding,maxY=padding,rowHeight=0;
      for(const [i,a] of product.assets[category].entries()){
        if(!(a.width>0&&a.height>0))fail('METADATA_REQUIRED','Missing real dimensions for '+a.asset_id);
        const h=width*a.height/a.width;
        if(category==='sku_images'&&i>0&&i%5===0){localX=padding;localY+=rowHeight+gap;rowHeight=0;}
        placements.push({asset:a,x:localX,y:localY,width,height:h});maxX=Math.max(maxX,localX+width);maxY=Math.max(maxY,localY+h);rowHeight=Math.max(rowHeight,h);
        if(category==='detail_images')localY+=h;else localX+=width+gap;
      }
      local[category].push({product,placements,frame:{id,name:product.shop.shopName,x:0,y:0,width:Math.max(width+padding*2,maxX+padding),height:Math.max(120,maxY+padding)}});
    }
  }
  const frames=structuredClone(base?.batch.frames||[]),media=structuredClone(base?.batch.media||[]),regions=[];
  const reserve={main_images:2400,main_videos:1600,sku_images:1840,...options.columnWidths};let regionX=0;
  for(const category of REGIONS){
    const previous=base?.regions.find(r=>r.category===category);
    const horizontal=category==='detail_images';
    const columnWidth=previous?.width??Math.max(reserve[category]||0,...local[category].map(v=>v.frame.width));
    const x=previous?.x??regionX,y=previous?.y??80;
    let fx=horizontal?(previous?.next_x??x):x,fy=horizontal?y:(previous?.next_y??y);
    const frameIds=[...(previous?.frame_ids||[])];
    for(const {product,placements,frame:f} of local[category]){
      if(!horizontal&&f.width>columnWidth)fail('REGION_CAPACITY_EXCEEDED',category+' requires '+f.width+' units; reserved '+columnWidth+'. Existing elements were preserved.');
      f.x=fx;f.y=fy;frames.push(f);frameIds.push(f.id);
      for(const p of placements){const a=p.asset;media.push({id:manifest.run_id+'-'+a.asset_id+'-'+category,kind:a.kind,urls:[a.url],frameId:f.id,placement:{mode:'explicit',positions:[{x:fx+p.x,y:fy+p.y,width:p.width,height:p.height}]},...(a.posterUrl?{posterUrl:a.posterUrl}:{}),sourceMetadata:{sourceUrl:product.url,productId:product.id,shopId:String(product.shop.shopId||''),category,assetId:a.asset_id}});}
      if(horizontal)fx+=f.width+frameGap;else fy+=f.height+frameGap;
    }
    const members=frames.filter(f=>frameIds.includes(f.id));
    regions.push({category,x,y,width:columnWidth,axis:horizontal?'horizontal':'vertical',next_x:horizontal?fx:x,next_y:horizontal?y:fy,bottom:Math.max(y,...members.map(f=>f.y+f.height)),right:Math.max(x,...members.map(f=>f.x+f.width)),frame_ids:frameIds});
    regionX=x+columnWidth+regionGap;
  }
  const name=base?.title||options.title||manifest.products[0].title+(manifest.products.length>1?` 等${manifest.products.length}款`:'');
  if(name.length>200)fail('INVALID_INPUT','Canvas title exceeds 200 characters; provide --title.');
  const labels={main_images:'主图区',main_videos:'主图视频区',sku_images:'SKU区',detail_images:'详情页区'};
  const texts=base?.batch.texts?structuredClone(base.batch.texts):regions.map(r=>({id:'region-'+uid([manifest.run_id,r.category]),text:labels[r.category],x:r.x,y:r.y-72,width:320,height:40,fontSize:28}));
  const result={schema_version:2,presentation_version:1,run_id:manifest.run_id,title:name,layout_options:{width,gap,padding,frameGap,regionGap},regions,batch:{frames,media,texts},...(base?{base_run_id:base.run_id}:{})};validateLayout(result);return result;
}
export function validateLayout(plan){
  const overlap=(a,b)=>a.x<b.x+b.width-1e-6&&a.x+a.width>b.x+1e-6&&a.y<b.y+b.height-1e-6&&a.y+a.height>b.y+1e-6;
  const {frames,media}=plan.batch;
  for(let i=0;i<frames.length;i++)for(let j=i+1;j<frames.length;j++)if(overlap(frames[i],frames[j]))fail('LAYOUT_OVERLAP','Frames overlap.');
  for(const f of frames){const items=media.filter(m=>m.frameId===f.id).map(m=>m.placement.positions[0]);for(const a of items)if(a.x<f.x||a.y<f.y||a.x+a.width>f.x+f.width+1e-6||a.y+a.height>f.y+f.height+1e-6)fail('LAYOUT_BOUNDS','Media outside frame.');for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)if(overlap(items[i],items[j]))fail('LAYOUT_OVERLAP','Media overlaps.');}
  return true;
}
export async function planRun(run,options={}){
  for(const file of ['layout.plan.json','canvas.batch.json'])if(await exists(path.join(run,file)))fail('OUTPUT_EXISTS','Plan already exists; preserve it or use a new run.');
  const manifest=await read(path.join(run,'assets.manifest.json'));let base,baseManifest,state;
  if(options.baseRun){
    base=await read(path.join(options.baseRun,'layout.plan.json'));baseManifest=await read(path.join(options.baseRun,'assets.manifest.json'));state=await read(path.join(options.baseRun,'canvas.state.json'));
    if(base.schema_version!==2)fail('LAYOUT_MIGRATION_REQUIRED','Run reflow on the base canvas before append.');
    if(state.status!=='completed'||!state.canvas_id)fail('STATE_CONFLICT','Base canvas must be completed.');
    if(manifest.products.some(p=>baseManifest.products.some(old=>old.id===p.id)))fail('PRODUCT_ALREADY_PRESENT','A product is already in this canvas; existing materials are preserved.');
  }
  const cache=new Map(),all=manifest.products.flatMap(p=>Object.values(p.assets).flat()),urls=[...new Map(all.map(a=>[a.url,a])).values()];
  for(let i=0;i<urls.length;i+=4)await Promise.all(urls.slice(i,i+4).map(async a=>cache.set(a.url,a.width>0&&a.height>0?{width:a.width,height:a.height}:await invoke('sealseek-media',['media','inspect','--url',a.url,'--kind',a.kind,'--json']))));
  for(const a of all){const d=cache.get(a.url);a.width=d.width;a.height=d.height;}
  const plan=layout(manifest,{...options,basePlan:base});
  if(base){plan.target_canvas_id=state.canvas_id;plan.base_snapshot=base.batch;manifest.products=[...baseManifest.products,...manifest.products];}
  await checkpoint(path.join(run,'assets.manifest.json'),manifest);
  await create(path.join(run,'layout.plan.json'),plan);await create(path.join(run,'canvas.batch.json'),plan.batch);
  return {run_id:plan.run_id,frames:plan.batch.frames.length,media:plan.batch.media.length,title:plan.title,...(state?{canvas_id:state.canvas_id,appending:true}:{})};
}
export async function appendRun(run,baseRun,inputs,rawFiles=[]){
  const previous=await read(path.join(baseRun,'assets.manifest.json')),plan=await read(path.join(baseRun,'layout.plan.json'));
  if(plan.schema_version!==2)fail('LAYOUT_MIGRATION_REQUIRED','Run reflow on base canvas first.');
  const fresh=normalizeInputs(inputs).filter(p=>!previous.products.some(old=>old.id===p.id));
  if(!fresh.length)return {changed:false,reason:'All requested products are already present.',base_run:baseRun};
  await collect(run,fresh.map(p=>p.input),rawFiles);
  return planRun(run,{baseRun});
}
export function matchesBatch(readback,batch){
  const elements=readback.elements.filter(e=>!e.isDeleted);
  if(elements.filter(e=>e.type==='frame').length!==batch.frames.length||elements.filter(e=>e.type==='image').length!==batch.media.length)return false;
  if(!(batch.texts||[]).every(t=>{const e=elements.find(e=>e.id===t.id);return e&&e.type==='text'&&['text','x','y','width','height','fontSize'].every(k=>e[k]===t[k]);}))return false;
  return batch.frames.every(f=>{const e=elements.find(e=>e.id===f.id);return e&&['name','x','y','width','height'].every(k=>e[k]===f[k]);})&&batch.media.every(m=>{const e=elements.find(e=>e.customData?.cliTaskId===m.id);return e&&e.frameId===m.frameId&&['x','y','width','height'].every(k=>e[k]===m.placement.positions[0][k])&&(m.kind==='video'?e.customData.videoUrl:e.customData.fileUrl)===m.urls[0];});
}
// Keep the actual server geometry for numerically equivalent bounds and caller-owned label formatting.
export function reconcileBatch(readback,batch){
  const result=structuredClone(batch),elements=readback.elements.filter(e=>!e.isDeleted);
  const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-6;
  for(const f of result.frames){const e=elements.find(e=>e.id===f.id);if(e&&e.type==='frame'&&e.name===f.name&&['x','y','width','height'].every(k=>near(e[k],f[k])))for(const k of ['x','y','width','height'])f[k]=e[k];}
  for(const m of result.media){const e=elements.find(e=>e.customData?.cliTaskId===m.id),p=m.placement.positions[0];if(e&&e.frameId===m.frameId&&['x','y','width','height'].every(k=>near(e[k],p[k])))for(const k of ['x','y','width','height'])p[k]=e[k];}
  for(const t of result.texts||[]){const e=elements.find(e=>e.id===t.id);if(e&&e.type==='text'&&e.text===t.text&&near(e.x,t.x)&&near(e.y,t.y)&&['width','height','fontSize'].every(k=>Number.isFinite(e[k])&&e[k]>0))for(const k of ['x','y','width','height','fontSize'])t[k]=e[k];}
  return result;
}
export async function publishCanvas(run,submit=false){
  const plan=await read(path.join(run,'layout.plan.json'));validateLayout(plan);
  const file=path.join(run,'canvas.batch.json');let batch=await read(file);if(JSON.stringify(batch)!==JSON.stringify(plan.batch))fail('STATE_CONFLICT','Batch differs from validated layout.');
  if(!submit)return {dry_run:true,title:plan.title,frames:batch.frames.length,media:batch.media.length};
  await invoke('sealseek-media',['canvas','batch','preview','--file',file,'--json']);
  if(plan.target_canvas_id){const current=await invoke('sealseek-media',['canvas','get',plan.target_canvas_id,'--json']);const baseline=reconcileBatch(current,plan.base_snapshot),normalized=reconcileBatch(current,batch);if(!matchesBatch(current,baseline)&&!matchesBatch(current,normalized))fail('CANVAS_CHANGED','Base canvas differs from the saved layout. Use the newest completed run; existing elements are preserved.');if(JSON.stringify(normalized)!==JSON.stringify(batch)){batch=normalized;plan.batch=batch;plan.base_snapshot=baseline;validateLayout(plan);await checkpoint(file,batch);await checkpoint(path.join(run,'layout.plan.json'),plan);}}
  const statePath=path.join(run,'canvas.state.json');let state=await exists(statePath)?await read(statePath):{run_id:plan.run_id,status:'ready',...(plan.target_canvas_id?{canvas_id:plan.target_canvas_id}:{})};
  if(state.run_id!==plan.run_id)fail('STATE_CONFLICT','Canvas state is from another run.');
  if(!state.canvas_id){if(state.status==='creating')fail('SUBMISSION_UNCERTAIN','Canvas creation outcome unknown. Inspect canvas list and bind recovered ID before retrying.');state.status='creating';await checkpoint(statePath,state);const board=await invoke('sealseek-media',['canvas','create','--title',plan.title,'--submit','--json']);if(!board.canvas_id)fail('SUBMISSION_UNCERTAIN','No canvas ID.');state={...state,...board,status:'created'};await checkpoint(statePath,state);}
  const saved=await invoke('sealseek-media',['canvas','batch',state.canvas_id,'--file',file,'--submit','--json']);
  const readback=await invoke('sealseek-media',['canvas','get',state.canvas_id,'--json']);
  const elements=readback.elements.filter(e=>!e.isDeleted),frames=elements.filter(e=>e.type==='frame'),media=elements.filter(e=>e.type==='image');
  if(frames.length!==batch.frames.length||media.length!==batch.media.length)fail('OUTPUT_CONTRACT_FAILED','Readback element count mismatch.');
  for(const f of batch.frames){const found=frames.find(e=>e.id===f.id);if(!found||!['name','x','y','width','height'].every(k=>found[k]===f[k]))fail('OUTPUT_CONTRACT_FAILED','Frame readback mismatch.');}
  for(const m of batch.media){const e=media.find(e=>e.customData?.cliTaskId===m.id);if(!e||e.frameId!==m.frameId||!['x','y','width','height'].every(k=>e[k]===m.placement.positions[0][k])||(m.kind==='video'?e.customData.videoUrl:e.customData.fileUrl)!==m.urls[0])fail('OUTPUT_CONTRACT_FAILED','Media readback mismatch.');}
  if(!matchesBatch(readback,batch))fail('OUTPUT_CONTRACT_FAILED','Canvas labels or content readback mismatch.');
  await checkpoint(statePath,{...state,status:'completed',canvas_url:readback.canvas_url});
  const manifest=await read(path.join(run,'assets.manifest.json')),report={run_id:plan.run_id,status:'completed',canvas_id:state.canvas_id,canvas_url:readback.canvas_url,frames:frames.length,media:media.length,products:manifest.products.map(p=>({id:p.id,title:p.title,shop:p.shop.shopName,coverage:p.coverage,counts:Object.fromEntries(Object.entries(p.assets).map(([k,v])=>[k,v.length]))})),saved,verification:'saved content read back and layout checked; browser visual inspection is separate'};
  await checkpoint(path.join(run,'collection-report.json'),report);return report;
}
