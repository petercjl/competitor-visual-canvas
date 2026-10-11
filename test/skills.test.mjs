import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {install,status} from '../src/skills.mjs';
test('all three Agents install UTF-8 UI metadata and locked managed updates preserve customization',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-skill-'));
 try{for(const agent of ['codex','sealseek','workbuddy']){
 const target=path.join(dir,agent);await install(agent,{path:target});assert((await status(agent,target)).current);
 const yaml=path.join(target,'agents','openai.yaml');await fs.appendFile(yaml,'\n# customized\n');
 const marker=path.join(target,'.competitor-visual-canvas-install.json');const v=JSON.parse(await fs.readFile(marker));v.version='0.0.0';await fs.writeFile(marker,JSON.stringify(v));
 const result=await install(agent,{path:target,rename:async()=>{throw Object.assign(Error('locked'),{code:'EPERM'});}});assert(result.backup);assert((await fs.readFile(yaml,'utf8')).includes('# customized'));assert((await fs.readFile(path.join(target,'SKILL.md'),'utf8')).includes('竞品'));assert((await status(agent,target)).current);
 await fs.appendFile(path.join(target,'SKILL.md'),'\nlocal edit\n');await assert.rejects(install(agent,{path:target}),{code:'LOCAL_EDITS'});
 }}finally{await fs.rm(dir,{recursive:true,force:true});}
});
