const fs = require('fs');
const path = require('path');
const obj = JSON.parse(fs.readFileSync(path.join(process.cwd(),'service-describe.json'),'utf8'));
const image = obj.spec.template.spec.containers[0].image;
const serviceAccount = obj.spec.template.spec.serviceAccountName || obj.spec.template.spec.serviceAccount || obj.spec.template.spec.serviceAccount || obj.spec.template.spec.serviceAccount;
const yaml = `apiVersion: run.googleapis.com/v1
kind: Job
metadata:
  name: initial-owner-bootstrap
  labels:
    purpose: one-time-bootstrap
spec:
  template:
    template:
      spec:
        serviceAccountName: ${serviceAccount}
        containers:
        - image: "${image}"
          command: ["node", "dist/bootstrap-initial-owner.cjs"]
          env:
          - name: SPR_INITIAL_OWNER_EMAIL
            valueFrom:
              secretKeyRef:
                name: SPR_INITIAL_OWNER_EMAIL
          - name: SPR_OWNER_BOOTSTRAP_SECRET
            valueFrom:
              secretKeyRef:
                name: SPR_OWNER_BOOTSTRAP_SECRET
          - name: SPR_OWNER_BOOTSTRAP_SECRET_SHA256
            valueFrom:
              secretKeyRef:
                name: SPR_OWNER_BOOTSTRAP_SECRET_SHA256
          - name: FIREBASE_SERVICE_ACCOUNT_KEY
            valueFrom:
              secretKeyRef:
                name: FIREBASE_SERVICE_ACCOUNT_KEY
        restartPolicy: Never
`;
fs.mkdirSync(path.join(process.cwd(),'deploy'), { recursive: true });
fs.writeFileSync(path.join(process.cwd(),'deploy','initial-owner-job.yaml'), yaml, 'utf8');
console.log('WROTE_YAML');
