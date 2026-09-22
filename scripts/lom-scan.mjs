#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { extname, basename, resolve, dirname } from 'node:path';
const args=process.argv.slice(2);
const arg=(name)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined};
const root=process.cwd();
const runtimeUrl=(arg('--runtime-url')||process.env.LOM_RUNTIME_URL||'').replace(/\/$/,'');
const reportPath=resolve(root,arg('--report')||'artifacts/lom-report.json');
const findings=[],inventory=[];
const add=(severity,category,title,file,detail)=>findings.push({severity,category,title,file:file||null,detail:detail||null});
const TEST_OR_CI=/(^|\/)(?:tests?|__tests__|__mocks__|__fixtures__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|^\.github\/workflows\//i;
const ENV_NAME=/^[A-Z][A-Z0-9_]{2,}$/;
const PLACEHOLDER=/(missing|placeholder|changeme|not[-_]?(?:a[-_]?)?secret|invalid|example|dummy|fixture|xxx|your[-_])/i;
const isPlausibleSecret=(value)=>!ENV_NAME.test(value)&&!PLACEHOLDER.test(value);
const textExts=new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.json','.yaml','.yml','.toml','.ini','.md','.txt','.sql','.sh','.ps1','.bat','.cmd','.xml','.html','.css','.scss','.lock','.conf','.config','.properties','.tf','.tfvars']);
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8',maxBuffer:50*1024*1024}).split('\0').filter(Boolean);
const hash=(v)=>createHash('sha256').update(v).digest('hex');
for(const file of files){
  const full=resolve(root,file); let size=0; try{size=statSync(full).size}catch{add('high','inventory','Tracked file missing from workspace',file);continue}
  const record={file,bytes:size,sha256:null};inventory.push(record);
  if(size>2000000||!(textExts.has(extname(file.toLowerCase()))||basename(file).toLowerCase().startsWith('dockerfile')))continue;
  let content;try{content=readFileSync(full,'utf8')}catch{add('high','inventory','Tracked file could not be inspected',file);continue}
  record.sha256=hash(content);
  if(/^\.env(?:\.|$)/i.test(basename(file))||/\.(pem|key|p12|pfx)$/i.test(file))add('critical','credential-material','Credential-bearing file is tracked',file,'Remove it from source control and rotate any real credential.');
  if(!TEST_OR_CI.test(file)){
  const genericSecret=/(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*[\"']([^\"']{12,})[\"']/ig;
  for(const m of content.matchAll(genericSecret)){if(m[1]&&isPlausibleSecret(m[1])){add('high','credential-exposure','Possible hard-coded credential assignment',file,'Move credentials to the deployment secret store and keep source values non-secret.');break;}}
}
  if(/(?:curl|wget)[^\n|]{0,300}\|\s*(?:ba)?sh\b/i.test(content))add('high','execution','Remote content is piped directly to a shell',file,'Pin and verify downloaded artifacts before execution.');
  if(/\bchmod\s+(?:-R\s+)?777\b/i.test(content))add('high','permissions','World-writable permissions requested',file,'Use least privilege.');
  if(!TEST_OR_CI.test(file)&&/(?<![.\w$])(?:eval|Function)\s*\(/.test(content)||!TEST_OR_CI.test(file)&&/\bnew\s+Function\s*\(/.test(content))add('high','execution','Dynamic code execution primitive found',file,'Review whether untrusted input can reach the execution boundary.');
  if(/\.github\/workflows\//.test(file)&&/permissions:\s*write-all/i.test(content))add('high','workflow','Workflow requests write-all permissions',file,'Use least-privilege permissions.');
}
if(existsSync(resolve(root,'package-lock.json'))){
  const audit=spawnSync('npm',['audit','--json'],{encoding:'utf8',maxBuffer:20*1024*1024});let parsed=null;try{parsed=JSON.parse(audit.stdout||'')}catch{}
  const v=parsed?.metadata?.vulnerabilities;
  if(v)for(const s of ['critical','high','moderate','low'])if(Number(v[s]||0)>0)add(s==='critical'?'critical':s==='high'?'high':'medium','dependency','npm audit reports '+v[s]+' '+s+' finding(s)','package-lock.json',JSON.stringify(v));
  else if(audit.status!==0)add('high','dependency','npm audit failed to produce a usable report',null,audit.stderr||'npm audit failed');
}
try{const p=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));const deps={...(p.dependencies||{}),...(p.devDependencies||{}),...(p.optionalDependencies||{})};for(const [name,version] of Object.entries(deps))inventory.push({program:name,declaredVersion:version});if(p.scripts?.preinstall||p.scripts?.install||p.scripts?.postinstall)add('medium','supply-chain','Package lifecycle install scripts are present','package.json','Review every lifecycle script.')}catch(e){add('high','inventory','package.json could not be parsed','package.json',String(e))}
if(runtimeUrl){for(const p of ['/health','/ready']){const code="fetch(process.argv[1]).then(async r=>{console.log(JSON.stringify({status:r.status,body:(await r.text()).slice(0,2000)}));process.exit(r.ok?0:2)}).catch(e=>{console.error(String(e));process.exit(3)})";const r=spawnSync('node',['-e',code,runtimeUrl+p],{encoding:'utf8',timeout:25000});let x=null;try{x=JSON.parse(r.stdout||'')}catch{}if(!x)add('high','runtime','Runtime probe returned no valid response',runtimeUrl+p,r.stderr||'No response');else if(x.status>=500)add('critical','runtime','Runtime endpoint returned server error',runtimeUrl+p,JSON.stringify(x));else if(p==='/ready'&&x.status!==200)add('high','runtime','Production readiness endpoint is not ready',runtimeUrl+p,JSON.stringify(x));else if(x.status>=400)add('high','runtime','Runtime endpoint returned HTTP '+x.status,runtimeUrl+p,JSON.stringify(x));}}
const counts=findings.reduce((a,f)=>(a[f.severity]=(a[f.severity]||0)+1,a),{});
const report={scanner:'SPR-LOM',version:'1.0.0',generatedAt:new Date().toISOString(),commit:process.env.GITHUB_SHA||null,runtimeUrl:runtimeUrl||null,inventoryCount:inventory.length,findingCounts:counts,status:(counts.critical||counts.high)?'BLOCKED':'OBSERVED',findings,inventory};
mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2));
console.log('LOM '+report.status+': scanned '+inventory.length+' inventory records; findings '+JSON.stringify(counts));
for(const f of findings)console.log('['+f.severity.toUpperCase()+'] '+f.category+': '+f.title+(f.file?' ('+f.file+')':''));
process.exit((counts.critical||counts.high)?2:0);