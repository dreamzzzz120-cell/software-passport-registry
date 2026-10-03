// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ClientGalaxyView from '../src/components/ClientGalaxyView';
import type { Client, SoftwarePassport } from '../src/types';

afterEach(cleanup);

const client: Client = {
  id:'c1', name:'Acme', domain:'acme.test', industry:'Technology', trustScore:'Not assessed', riskLevel:'Unknown', avatarColor:'indigo', subscriptionTier:'Standard', joinedDate:'2026-01-01', teamCount:1, passportCount:1, criticalRisksCount:0, complianceProgress:'Not assessed',
  softwareInventory:[{passportId:'p1',name:'Alpha',version:'1.0',overallScore:0,riskStatus:'Warning',lastScanDate:'2026-01-01'}], complianceStatus:[], teamMembers:[], activityTimeline:[],
};
const passport: SoftwarePassport = {
  id:'p1', clientId:'c1', name:'Alpha', version:'1.0', publisher:'Example', category:'Service', overallScore:null, securityScore:null, complianceScore:null, vendorReputationScore:null, confidenceScore:null, evidenceCompleteness:null, verificationStatus:'unverified', releaseDate:'', fileHash:'', licenseType:'', aiSummary:'', sbom:[], evidence:[], vulnerabilities:[], timeline:[],
};

describe('ClientGalaxyView', () => {
  it('renders only client-linked persisted Launch Tickets and preserves UNKNOWN for missing evidence', () => {
    render(<ClientGalaxyView client={client} passports={[passport,{...passport,id:'p2',name:'Other'}]} onClose={()=>{}} onOpenLaunchTicket={()=>{}} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.queryByText('Other')).toBeNull();
    expect(screen.getByText('UNKNOWN')).toBeTruthy();
    expect(screen.getByText(/will not manufacture stars/i)).toBeNull();
  });

  it('opens the selected Launch Ticket from the star inspector', () => {
    const open = vi.fn();
    render(<ClientGalaxyView client={client} passports={[passport]} onClose={()=>{}} onOpenLaunchTicket={open} />);
    fireEvent.click(screen.getByText('Alpha'));
    fireEvent.click(screen.getByRole('button',{name:/Open Launch Ticket/i}));
    expect(open).toHaveBeenCalledWith('p1');
    expect(screen.getByText(/UNKNOWN is an evidence gap, never PASS/i)).toBeTruthy();
  });

  it('shows history as UNKNOWN when no persisted client history exists', () => {
    render(<ClientGalaxyView client={client} passports={[passport]} onClose={()=>{}} onOpenLaunchTicket={()=>{}} />);
    fireEvent.click(screen.getByRole('button',{name:'History'}));
    expect(screen.getByText(/UNKNOWN — no persisted client activity history/i)).toBeTruthy();
  });

  it('does not describe verification as authorization in the Govern lens', () => {
    render(<ClientGalaxyView client={client} passports={[{...passport,evidence:[{id:'e1',name:'scan',type:'Security Scan',status:'OBSERVED',signer:'scanner',timestamp:'2026-01-01',hash:'abc'}]}]} onClose={()=>{}} onOpenLaunchTicket={()=>{}} />);
    fireEvent.click(screen.getByRole('button',{name:'Govern'}));
    expect(screen.getByText('Verification: UNVERIFIED')).toBeTruthy();
    expect(screen.queryByText(/Authority:/i)).toBeNull();
  });
});
