import path from 'node:path';
import crypto from 'node:crypto';
import {read,layout,invoke,create,checkpoint,fail} from './workflow.mjs';
export function backgroundPlacements(elements,frames){
  const bounds=e=>Object.fromEntries(['x','y','width','height'].map(k=>[k,e[k]]));
  return elements.filter(e=>!e.isDeleted&&e.customData?.type==='frame-background'&&e.customData.ownerFrameId===e.frameId).flatMap(e=>{
    const frame=frames.find(f=>f.id===e.frameId);
    return frame?[{id:e.id,...bounds(frame),expected:bounds(e)}]:[];
  });
}
export async function reflowRun(run,submit=false){
  const previous=await read(path.join(run,'layout.plan.json'));
  if(previous.schema_version===2&&previous.presentation_version===1)return {changed:false,reason:'Current presentation already active.'};
  const manifest=await read(path.join(run,'assets.manifest.json')),state=await read(path.join(run,'canvas.state.json'));
  if(!state.canvas_id)fail('STATE_CONFLICT','No existing canvas for this run.');
  const next=layout(manifest,{title:previous.title});
  for(const r of next.regions){const old=previous.regions?.find(v=>v.category===r.category);if(old)r.frame_ids=r.frame_ids.map((id,i)=>{const oldId=old.frame_ids?.[i];if(oldId){next.batch.frames.find(f=>f.id===id).id=oldId;for(const m of next.batch.media)if(m.frameId===id)m.frameId=oldId;}return oldId||id;});}
  for(const m of next.batch.media){const old=previous.batch.media.find(v=>v.sourceMetadata?.assetId===m.sourceMetadata.assetId&&v.sourceMetadata?.category===m.sourceMetadata.category&&v.sourceMetadata?.productId===m.sourceMetadata.productId);if(old)m.id=old.id;}
  const oldBatch=await read(path.join(run,'canvas.batch.json'));
  if(![previous.batch,next.batch].some(b=>JSON.stringify(b)===JSON.stringify(oldBatch)))fail('STATE_CONFLICT','Batch differs from the owned layout.');
  const live=await invoke('sealseek-media',['canvas','get',state.canvas_id,'--json']);
  const placements=[];
  const bounds=e=>Object.fromEntries(['x','y','width','height'].map(k=>[k,e[k]]));
  for(const f of next.batch.frames){const current=live.elements.find(e=>e.id===f.id&&!e.isDeleted);if(!current)fail('ELEMENT_NOT_FOUND','Frame missing during migration.');placements.push({id:current.id,...bounds(f),expected:bounds(current)});}
  for(const m of next.batch.media){const current=live.elements.find(e=>e.customData?.cliTaskId===m.id&&!e.isDeleted);if(!current)fail('ELEMENT_NOT_FOUND','Media missing during migration.');placements.push({id:current.id,...m.placement.positions[0],expected:bounds(current)});}
  placements.push(...backgroundPlacements(live.elements,next.batch.frames));
  if(!submit)return {dry_run:true,canvas_id:state.canvas_id,frames:next.batch.frames.length,media:next.batch.media.length,regions:next.regions.map(r=>({category:r.category,x:r.x,axis:r.axis}))};
  const file=path.join(run,'reflow-'+crypto.randomUUID()+'.json');await create(file,placements);
  const saved=await invoke('sealseek-media',['canvas','place',state.canvas_id,'--file',file,'--submit','--json']);
  const batchFile=path.join(run,'reflow-batch-'+crypto.randomUUID()+'.json');await create(batchFile,next.batch);
  await invoke('sealseek-media',['canvas','batch',state.canvas_id,'--file',batchFile,'--submit','--json']);
  const after=await invoke('sealseek-media',['canvas','get',state.canvas_id,'--json']);
  if(!placements.every(p=>{const e=after.elements.find(e=>e.id===p.id);return e&&['x','y','width','height'].every(k=>e[k]===p[k]);}))fail('OUTPUT_CONTRACT_FAILED','Reflow readback mismatch.');
  await checkpoint(path.join(run,'canvas.batch.json'),next.batch);
  await checkpoint(path.join(run,'layout.plan.json'),next);
  await checkpoint(path.join(run,'canvas.state.json'),{...state,status:'completed',layout_version:2,presentation_version:1});
  return {saved:true,canvas_id:state.canvas_id,canvas_url:after.canvas_url,...saved};
}
