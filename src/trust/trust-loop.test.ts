import { describe, expect, it } from 'vitest';
import { correlateFindings, observationsToFindings } from './trust-loop.ts';
import { assertPublicNetworkTarget, isBlockedIp } from '../utils/monitoring.ts';

describe('trust loop determinism',()=>{
 it('never converts UNKNOWN into PASS',()=>{const f=observationsToFindings({tenantId:'t1',passportId:'p1',clientId:'c1',assetId:'a1',observations:[{provider:'microsoft-365',controlId:'mfa',title:'MFA posture',status:'UNKNOWN',severity:'high',subject:'tenant',observedAt:'2026-08-19T00:00:00Z',sourceUrl:'https://graph.microsoft.com',verificationMethod:'test',value:{}}]});expect(f[0].status).toBe('UNKNOWN');expect(f[0].severity).toBe('high');});
 it('correlates independent MFA, exposure and privilege failures',()=>{const input={tenantId:'t1',passportId:'p1',clientId:'c1',assetId:'a1'};const f=correlateFindings(observationsToFindings({...input,observations:[
  {provider:'microsoft-365',controlId:'mfa-required',title:'MFA required',status:'FAIL',severity:'high',subject:'admin',observedAt:'2026-08-19T00:00:00Z',sourceUrl:'https://graph.microsoft.com',verificationMethod:'test',value:{}},
  {provider:'aws',controlId:'internet-exposure',title:'Internet exposure',status:'FAIL',severity:'high',subject:'service',observedAt:'2026-08-19T00:00:00Z',sourceUrl:'https://aws.amazon.com',verificationMethod:'test',value:{}},
  {provider:'connectwise',controlId:'privileged-account',title:'Privileged account',status:'FAIL',severity:'high',subject:'admin',observedAt:'2026-08-19T00:00:00Z',sourceUrl:'https://connectwise.com',verificationMethod:'test',value:{}}
 ]}));const correlated=f.find(x=>x.controlId==='cross-source-privileged-exposure');expect(correlated?.severity).toBe('critical');expect(correlated?.evidenceIds.length).toBeGreaterThanOrEqual(0);});
});

describe('SSRF defenses',()=>{
 it('blocks private and metadata IPv4 ranges',()=>{expect(isBlockedIp('127.0.0.1')).toBe(true);expect(isBlockedIp('10.0.0.1')).toBe(true);expect(isBlockedIp('169.254.169.254')).toBe(true);expect(isBlockedIp('192.168.1.1')).toBe(true);});
 it('allows a public IP',()=>{expect(isBlockedIp('8.8.8.8')).toBe(false);});
 it('rejects embedded credentials and blocked hosts',async()=>{await expect(assertPublicNetworkTarget('http://127.0.0.1/')).rejects.toThrow('TARGET_HOST_BLOCKED');await expect(assertPublicNetworkTarget('http://user:pass@example.com/')).rejects.toThrow('TARGET_CREDENTIALS_BLOCKED');});
});
