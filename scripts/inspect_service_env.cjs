const fs = require('fs');
const path = require('path');
const f = path.join(process.cwd(),'service-describe.json');
const obj = JSON.parse(fs.readFileSync(f,'utf8'));
const containers = obj.spec && obj.spec.template && obj.spec.template.spec && obj.spec.template.spec.containers || [];
const envs = {};
for(const c of containers){
  for(const e of c.env||[]){
    if(e.valueFrom && e.valueFrom.secretKeyRef) envs[e.name] = { source: 'secret', secretName: e.valueFrom.secretKeyRef.name };
    else if(e.value !== undefined) envs[e.name] = { source: 'literal' };
    else envs[e.name] = { source: 'unknown' };
  }
}
console.log(JSON.stringify(envs,null,2));
