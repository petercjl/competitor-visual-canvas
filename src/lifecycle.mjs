export {ROOT,META} from './core.mjs';
import {SOURCE,status,install} from './skills.mjs';
import {META} from './core.mjs';
export async function skill(action,agent='codex',custom){
 if(action==='source')return {source:SOURCE,name:'competitor-visual-canvas',version:META.version};
 if(action==='status'){const s=await status(agent,custom);return {...s,target:s.destination};}
 if(['install','update'].includes(action)){const s=await install(agent,{path:custom});return {...s,target:s.destination};}
 throw Object.assign(Error('Use skill source/status/install/update'),{code:'INVALID_INPUT'});
}
