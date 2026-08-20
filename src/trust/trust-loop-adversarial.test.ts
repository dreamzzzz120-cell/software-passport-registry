import { describe, expect, it } from 'vitest';
import { correlateFindings, observationsToFindings } from './trust-loop.ts';
import type { ControlObservation } from './trust-loop.ts';

const base={tenantId:'tenant-a',passportId:'passport-a',clientId:'client-a',assetId:'asset-a'};
const observation=(overrides:Partial<ControlObservation>={}):ControlObservation=>({provider:'provider-a',controlId:'control-a',title:'Control A',status:'FAIL',severity:'high',subject:'asset-a',observedAt:'2026-08-20T05:00:00.000Z',sourceUrl:'https://provider.example/control-a',verificationMethod:'authoritative-api',value:{observed:true},...overrides});

describe('trust loop adversarial invariants',()=>{
  it('keeps UNKNOWN unknown even when the title sounds positive',()=>{
    const [finding]=observationsToFindings({...base,observations:[observation({status:'UNKNOWN',title:'MFA enabled'})]});
    expect(finding.status).toBe('UNKNOWN');
  });

  it('creates deterministic finding identity for the same tenant/control/subject',()=>{
    const a=observationsToFindings({...base,observations:[observation()]})[0];
    const b=observationsToFindings({...base,observations:[observation({observedAt:'2026-08-20T06:00:00.000Z',value:{different:true}})]})[0];
    expect(a.id).toBe(b.id);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('changes finding identity across tenants',()=>{
    const a=observationsToFindings({...base,observations:[observation()]})[0];
    const b=observationsToFindings({...base,tenantId:'tenant-b',observations:[observation()]})[0];
    expect(a.id).not.toBe(b.id);
  });

  it('correlates evidence only from open contributing findings',()=>{
    const findings=observationsToFindings({...base,observations:[
      observation({provider:'m365',controlId:'mfa-required',title:'MFA required',status:'FAIL',evidenceId:'e-mfa'}),
      observation({provider:'cloud',controlId:'internet-exposure',title:'Internet exposed',status:'FAIL',evidenceId:'e-exposure'}),
      observation({provider:'iam',controlId:'privileged-account',title:'Privileged admin',status:'FAIL',evidenceId:'e-admin'}),
    ]});
    const correlated=correlateFindings(findings).find(f=>f.controlId==='cross-source-privileged-exposure');
    expect(correlated?.severity).toBe('critical');
    expect(correlated?.evidenceIds.sort()).toEqual(['e-admin','e-exposure','e-mfa']);
  });

  it('does not correlate resolved conditions into an active critical finding',()=>{
    const findings=observationsToFindings({...base,observations:[
      observation({controlId:'mfa-required',title:'MFA required',status:'UNKNOWN'}),
      observation({controlId:'internet-exposure',title:'Internet exposed',status:'FAIL'}),
      observation({controlId:'privileged-account',title:'Privileged admin',status:'FAIL'}),
    ]});
    findings[0].status='RESOLVED';
    expect(correlateFindings(findings).some(f=>f.controlId==='cross-source-privileged-exposure')).toBe(false);
  });
});
