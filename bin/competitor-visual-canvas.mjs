#!/usr/bin/env node
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {performUpdate,latestVersion,updateStatus,setAutomatic} from '../src/update.mjs';
import {collect,planRun,publishCanvas,invoke,read,fail,configureTool,appendRun} from '../src/workflow.mjs';
import {reflowRun} from '../src/reflow.mjs';
import {findCanvases,appendToCanvas} from '../src/canvas-target.mjs';
import {ROOT,META,skill} from '../src/lifecycle.mjs';
const argv=process.argv.slice(2),command=argv.shift(),options={},args=[];
function parse(){for(let i=0;i<argv.length;i++){const k=argv[i];if(k==='--json')continue;if(['--submit','--yes'].includes(k)){options[k.slice(2)]=true;continue;}if(k.startsWith('--')){const key=k.slice(2),value=argv[++i];if(!value||value.startsWith('--'))fail('INVALID_INPUT','Missing '+k);if(!['input','raw','run','title','agent','canvas','tool','entry','base-run','path'].includes(key))fail('INVALID_INPUT','Unknown '+k);(options[key]??=[]).push(value);}else args.push(k);}}
const one=k=>options[k]?.at(-1);
const help=`competitor-visual-canvas ${META.version}
  collect --input ID_OR_URL [--input MORE] --run NEW_DIR [--raw SAVED_COLLECTION.json ...] --json
  plan --run DIR [--title TEXT] [--base-run COMPLETED_DIR] --json
  find --title EXACT_TITLE --json (read-only exact-name lookup)
  append (--base-run COMPLETED_DIR | --title EXACT_TITLE | --canvas ID) --run NEW_DIR --input ID_OR_URL [--input MORE] [--raw FILE ...] --json
  reflow --run DIR [--submit] --json (migrate a legacy canvas to horizontal regions)
  canvas --run DIR [--submit] --json
  recover --run DIR --canvas ID --submit --json (bind verified existing canvas after uncertain creation)
  tool run tbcli|sealseek-media ARGS...
  configure --tool tbcli|sealseek-media --entry CLI_PATH --submit --json
  version | capabilities --json | doctor --json
  skill source|status|install|update [--agent codex|sealseek|workbuddy] [--path DIR] --json
  update check|install --yes --json
  update auto status|on|off --json
Requires tbcli item media and sealseek-media canvas batch/media inspect.
Global npm installations check stable updates daily during use and synchronize managed Skills.
Source development and suite-managed installations use their owner update path.`;
async function main(){
  if(!command||['--help','help'].includes(command))return {help};
  if(command==='tool'&&argv[0]==='run'){const tool=argv[1];if(!['tbcli','sealseek-media'].includes(tool))fail('INVALID_INPUT','Unknown dependency.');return invoke(tool,argv.slice(2));}
  parse();
  if(command==='configure'){if(!options.submit)fail('SUBMIT_REQUIRED','Configuring dependency entry requires --submit.');return configureTool(one('tool'),one('entry'));}
  if(command==='version')return {version:META.version};
  if(command==='skill')return skill(args[0],one('agent'),one('path'));
  if(command==='capabilities')return {...await read(path.join(ROOT,'skills','competitor-visual-canvas','capabilities.json')),execution:{frame_grouping:'four-per-product',inputs:'Taobao IDs or Taobao/Tmall detail URLs',archive:'canvas',supported_platform:process.platform==='darwin'?'macos':'unverified'}};
  if(command==='doctor'){const checks=[];for(const tool of ['tbcli','sealseek-media'])try{const source=await invoke(tool,['skill','source','--json']),capabilities=await invoke(tool,['capabilities','--json']);const s=source.source??source.data?.source;const valid=tool==='tbcli'?JSON.stringify(capabilities).includes('item media'):['frame-batch','text-batch','media-inspect','source-metadata'].every(f=>capabilities.manifest?.canvas_contract?.features?.includes(f));checks.push({tool,source:s,ok:!!s&&valid});}catch(e){checks.push({tool,ok:false,code:e.code??'CLI_UNAVAILABLE'});}return {ok:checks.every(c=>c.ok),checks,node:process.version,service_access:'not-checked'};}
  if(command==='update'){
    if(args[0]==='check'){const latest=await latestVersion();return {current:META.version,latest,updateAvailable:latest!==META.version};}
    if(args[0]==='auto'){if(args[1]==='status')return updateStatus();if(['on','off'].includes(args[1]))return setAutomatic(args[1]==='on');}
    if(args[0]==='install'){if(!options.yes)fail('AUTHORIZATION_REQUIRED','Use --yes for package update.');return performUpdate({automatic:false});}
    fail('INVALID_INPUT','Use update check/install or auto status/on/off.');
  }
  if(command==='find')return findCanvases(one('title'));
  const run=one('run');if(!run)fail('INVALID_INPUT','Provide --run DIR.');
  if(command==='collect'){const result=await collect(path.resolve(run),options.input||[],options.raw||[]);return {run_id:result.run_id,run:path.resolve(run),products:result.products.map(p=>({id:p.id,title:p.title,counts:Object.fromEntries(Object.entries(p.assets).map(([k,v])=>[k,v.length]))}))};}
  if(command==='plan')return planRun(path.resolve(run),{title:one('title'),baseRun:one('base-run')?path.resolve(one('base-run')):undefined});
  if(command==='append'){
    if(one('base-run')){if(one('title')||one('canvas'))fail('INVALID_INPUT','Use a base run or a canvas selector.');return appendRun(path.resolve(run),path.resolve(one('base-run')),options.input||[],options.raw||[]);}
    return appendToCanvas(path.resolve(run),{title:one('title'),canvas:one('canvas')},options.input||[],options.raw||[]);
  }
  if(command==='reflow')return reflowRun(path.resolve(run),!!options.submit);
  if(command==='canvas')return publishCanvas(path.resolve(run),!!options.submit);
  if(command==='recover'){if(!one('canvas')||!options.submit)fail('SUBMIT_REQUIRED','Recovery requires --canvas ID --submit.');const {checkpoint}=await import('../src/workflow.mjs');const plan=await read(path.join(run,'layout.plan.json')),board=await invoke('sealseek-media',['canvas','get',one('canvas'),'--json']);if(board.title!==plan.title)fail('STATE_CONFLICT','Recovered canvas title differs.');await checkpoint(path.join(run,'canvas.state.json'),{run_id:plan.run_id,canvas_id:board.canvas_id,canvas_url:board.canvas_url,status:'recovered'});return {recovered:true,...board};}
  fail('INVALID_INPUT','Unknown command.');
}
async function execute(){
 if(!['update','version','skill','capabilities','doctor','tool','help','--help'].includes(command)){
  const u=await performUpdate();if(!u.ok)process.stderr.write('Automatic update deferred: '+(u.error?.code||'UPDATE_FAILED')+'\n');if(u.updated){const r=spawnSync(process.execPath,[process.argv[1],...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,COMPETITOR_CANVAS_AUTO_UPDATE:'0'}});process.exit(r.status??1);}
 }
 return main();
}
execute().then(value=>console.log(JSON.stringify(value,null,2))).catch(e=>{console.error(JSON.stringify({ok:false,code:e.code??'FAILED',message:e.message,...(e.details?{details:e.details}:{})}));process.exitCode=1;});
