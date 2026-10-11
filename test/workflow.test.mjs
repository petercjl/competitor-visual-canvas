import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeInputs,normalizeProduct,layout,validateLayout,matchesBatch} from '../src/workflow.mjs';
test('IDs retain precision, default to Taobao, links deduplicate and unknown platforms fail',()=>{const r=normalizeInputs(['90071992547409930','https://item.taobao.com/item.htm?id=90071992547409930','https://detail.tmall.com/item.htm?id=2']);assert.equal(r.length,2);assert.equal(r[0].id,'90071992547409930');assert.equal(r[0].platform,'taobao');assert.throws(()=>normalizeInputs(['https://example.com/?id=1']),{code:'FEATURE_UNSUPPORTED'});});
const asset=(i,h=100,kind='image')=>({asset_id:String(i),url:'https://example.com/'+i,width:100,height:h,kind});
const product=(id)=>({id,title:'测试商品',url:'https://item.taobao.com/item.htm?id='+id,shop:{shopName:'同一家店',shopId:'s'},assets:{main_images:[asset(id+'m'),asset(id+'m2',200)],main_videos:[asset(id+'v',56,'video')],detail_images:[asset(id+'d',1200),asset(id+'d2',300)],sku_images:Array.from({length:12},(_,i)=>asset(id+'s'+i,i%2?200:100))}});
test('four frames per product respect distinct region axes and variable-height five-column SKU grid',()=>{const p=layout({run_id:'r',products:[product('1'),product('2')]});assert.equal(p.batch.frames.length,8);assert(p.batch.frames.every(f=>f.name==='同一家店'));const [m1,m2,v1,v2,s1,s2,d1,d2]=p.batch.frames;assert.equal(m1.x,m2.x);assert(m2.y>m1.y);assert.equal(v1.x,v2.x);assert(v2.y>v1.y);assert.equal(d1.y,d2.y);assert(d2.x>d1.x);assert.equal(s1.x,s2.x);assert(s2.y>s1.y);const skus=p.batch.media.filter(m=>m.frameId===s1.id).map(m=>m.placement.positions[0]);assert.equal(skus[4].y,skus[0].y);assert(skus[5].y>skus[1].y+skus[1].height);assert.equal(skus[5].x,skus[0].x);assert(validateLayout(p));p.batch.frames[1].y=m1.y;assert.throws(()=>validateLayout(p),{code:'LAYOUT_OVERLAP'});});
test('SKU image dedup retains all attribute and sku identities; missing dimensions stop layout',()=>{const raw={itemId:'1',detail:{itemId:'1',title:'商品',shop:{shopName:'店铺'},mainImages:[],properties:[{pid:'p',name:'色',values:[{vid:'a',name:'红',imageUrl:'https://example.com/a'},{vid:'b',name:'蓝',imageUrl:'https://example.com/a'}]}],skus:[]},mainVideos:{records:[]},description:{images:[]},coverage:{}};const p=normalizeProduct(normalizeInputs(['1'])[0],raw);assert.equal(p.assets.sku_images.length,1);assert.equal(p.assets.sku_images[0].skuOptions.length,2);assert.throws(()=>layout({run_id:'r',products:[p]}),{code:'METADATA_REQUIRED'});});


test('horizontal region order, vertical video frames and append keep all old media byte-identical',()=>{
 const base=layout({run_id:'base',products:[product('1')]});
 assert.deepEqual(base.regions.map(r=>r.category),['main_images','main_videos','sku_images','detail_images']);
 for(let i=1;i<base.regions.length;i++)assert(base.regions[i].x>base.regions[i-1].x+base.regions[i-1].width);
 assert(base.regions.every(r=>r.y===80));
 const next=layout({run_id:'next',products:[product('2')]},{basePlan:base});
 assert.deepEqual(next.batch.frames.slice(0,4),base.batch.frames);
 assert.deepEqual(next.batch.media.slice(0,base.batch.media.length),base.batch.media);
 for(const region of base.regions){const old=base.batch.frames.find(f=>f.id===region.frame_ids[0]);const added=next.batch.frames.find(f=>!base.batch.frames.some(b=>b.id===f.id)&&next.regions.find(r=>r.category===region.category).frame_ids.includes(f.id));if(region.category==='detail_images'){assert.equal(added.y,old.y);assert(added.x>old.x+old.width);}else{assert.equal(added.x,old.x);assert(added.y>old.y+old.height);}}
 assert(validateLayout(next));
 const wide=product('wide');wide.assets.main_images=Array.from({length:20},(_,i)=>asset('wide'+i));
 assert.throws(()=>layout({run_id:'third',products:[wide]},{basePlan:next}),{code:'REGION_CAPACITY_EXCEEDED'});
 assert.throws(()=>layout({run_id:'x',products:[product('3')]},{basePlan:{...base,schema_version:1}}),{code:'LAYOUT_MIGRATION_REQUIRED'});
});

test('snapshot check detects stale placements before append',()=>{const p=layout({run_id:'r',products:[product('1')]});const live={elements:[...p.batch.texts.map(t=>({...t,type:'text'})),...structuredClone(p.batch.frames).map(f=>({...f,type:'frame'})),...p.batch.media.map((m,i)=>({id:'e'+i,type:'image',frameId:m.frameId,...m.placement.positions[0],customData:{cliTaskId:m.id,fileUrl:m.urls[0],...(m.kind==='video'?{videoUrl:m.urls[0]}:{})}}))]};assert(matchesBatch(live,p.batch));live.elements[0].x++;assert.equal(matchesBatch(live,p.batch),false);});

import {backgroundPlacements} from '../src/reflow.mjs';
test('reflow includes server-generated Frame backgrounds and preserves old expected bounds',()=>{
 const bg={id:'f__bg',frameId:'f',type:'rectangle',x:0,y:80,width:100,height:120,customData:{type:'frame-background',ownerFrameId:'f'}};
 const frames=[{id:'f',x:2640,y:80,width:384,height:120}];
 assert.deepEqual(backgroundPlacements([bg,{...bg,id:'deleted',isDeleted:true},{...bg,id:'unrelated',frameId:'other'}],frames),[{id:'f__bg',x:2640,y:80,width:384,height:120,expected:{x:0,y:80,width:100,height:120}}]);
});

test('detail images join exactly with zero gap and region headings survive append unchanged',()=>{
 const p=layout({run_id:'a',products:[product('1'),product('2')]});
 assert.deepEqual(p.batch.texts.map(t=>t.text),['主图区','主图视频区','SKU区','详情页区']);
 for(const r of p.regions){const text=p.batch.texts.find(t=>t.x===r.x);assert(text.y+text.height<r.y);}
 for(const f of p.batch.frames.filter(f=>p.regions.find(r=>r.category==='detail_images').frame_ids.includes(f.id))){const media=p.batch.media.filter(m=>m.frameId===f.id).map(m=>m.placement.positions[0]);for(let i=1;i<media.length;i++){assert.equal(media[i].y,media[i-1].y+media[i-1].height);assert.equal(media[i].x,media[0].x);assert.equal(media[i].width,media[0].width);}}
 const next=layout({run_id:'b',products:[product('3')]},{basePlan:p});assert.deepEqual(next.batch.texts,p.batch.texts);assert.deepEqual(next.batch.frames.slice(0,p.batch.frames.length),p.batch.frames);
});

import {reconcileBatch} from '../src/workflow.mjs';
test('append preserves rendered label formatting and tiny float changes while blocking moved media',()=>{
 const p=layout({run_id:'r',products:[product('1')]});
 const live={elements:[...p.batch.texts.map(t=>({...t,type:'text',width:90,height:37,fontSize:29})),...p.batch.frames.map(f=>({...f,type:'frame'})),...p.batch.media.map((m,i)=>({id:'e'+i,type:'image',frameId:m.frameId,...m.placement.positions[0],customData:{cliTaskId:m.id,fileUrl:m.urls[0],...(m.kind==='video'?{videoUrl:m.urls[0]}:{})}}))]};
 live.elements.at(-1).y+=1e-12;
 const before=JSON.stringify(live);const normalized=reconcileBatch(live,p.batch);assert(matchesBatch(live,normalized));assert.equal(normalized.texts[0].fontSize,29);assert.equal(JSON.stringify(live),before);
 live.elements.at(-1).y+=10;assert.equal(matchesBatch(live,reconcileBatch(live,p.batch)),false);
 live.elements[0].text='changed';assert.equal(matchesBatch(live,reconcileBatch(live,p.batch)),false);
});
