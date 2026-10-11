import {fileURLToPath} from 'node:url';
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const entry=fileURLToPath(new URL('../bin/competitor-visual-canvas.mjs',import.meta.url));
test('fresh install, repeat install and managed update preserve canonical UI metadata; unmanaged targets refuse',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-install-'));const run=(...args)=>spawnSync(process.execPath,[entry,...args,'--json'],{encoding:'utf8',env:{...process.env,HOME:home,USERPROFILE:home}});
 try{assert.equal(JSON.parse(run('skill','status','--agent','codex').stdout).installed,false);assert.equal(run('skill','install','--agent','codex').status,0);assert.equal(run('skill','install','--agent','codex').status,0);assert.equal(JSON.parse(run('skill','update','--agent','codex').stdout).current,true);
  const target=path.join(home,'.codex','skills','competitor-visual-canvas');const yaml=await fs.readFile(path.join(target,'agents','openai.yaml'),'utf8');assert(yaml.includes('竞品'));await fs.rm(target,{recursive:true});await fs.mkdir(target);await fs.writeFile(path.join(target,'SKILL.md'),'user-owned');assert.notEqual(run('skill','install','--agent','codex').status,0);assert.equal(await fs.readFile(path.join(target,'SKILL.md'),'utf8'),'user-owned');
 }finally{await fs.rm(home,{recursive:true});}
});
test('doctor reports absent dependencies without claiming service access',async()=>{const home=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-doctor-'));try{const r=spawnSync(process.execPath,[entry,'doctor','--json'],{encoding:'utf8',env:{...process.env,HOME:home,USERPROFILE:home,TBCLI_ENTRY:path.join(home,'missing.mjs'),SEALSEEK_MEDIA_ENTRY:path.join(home,'other.mjs')}});assert.equal(r.status,0);const v=JSON.parse(r.stdout);assert.equal(v.ok,false);assert(v.checks.every(c=>!c.ok));assert.equal(v.service_access,'not-checked');}finally{await fs.rm(home,{recursive:true});}});
