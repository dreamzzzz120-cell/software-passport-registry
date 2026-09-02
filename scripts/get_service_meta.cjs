const fs = require('fs');
const path = require('path');
const obj = JSON.parse(fs.readFileSync(path.join(process.cwd(),'service-describe.json'),'utf8'));
const image = obj.spec.template.spec.containers[0].image;
const serviceAccount = obj.spec.template.spec.serviceAccountName || obj.spec.template.spec.serviceAccount;
const latestReadyRevision = obj.status.latestReadyRevisionName;
const traffic = obj.status.traffic || [];
console.log(JSON.stringify({ image, serviceAccount, latestReadyRevision, traffic }, null, 2));
