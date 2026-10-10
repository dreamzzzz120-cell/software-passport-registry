// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
vi.mock('../src/utils/apiClient', () => ({ apiFetch: vi.fn(async () => new Response('{}', { status: 404 })) }));
vi.mock('../src/lib/founderData', () => ({ useFounderData: () => ({ commandCenter: null, overview: null, loadedAt: null, loading: false, refresh: vi.fn() }) }));
vi.mock('../src/components/FounderCommandCenterPanel', () => ({ default: () => <div>FounderCommandCenterPanel</div> }));
vi.mock('../src/components/FounderMonitoringPanel', () => ({ default: () => <div>FounderMonitoringPanel</div> }));
vi.mock('../src/components/FounderLeadsPanel', () => ({ default: () => <div>FounderLeadsPanel</div> }));
vi.mock('../src/components/FounderInquiriesPanel', () => ({ default: () => <div>FounderInquiriesPanel</div> }));
vi.mock('../src/components/FounderRegistryCrawlerPanel', () => ({ default: () => <div>FounderRegistryCrawlerPanel</div> }));
vi.mock('../src/components/FounderTrafficPanel', () => ({ default: () => <div>FounderTrafficPanel</div> }));
vi.mock('../src/components/FounderDistributionOpportunities', () => ({ default: () => <div>FounderDistributionOpportunities</div> }));
vi.mock('../src/components/FounderGrowthHub', () => ({ default: () => <div>FounderGrowthHub</div> }));
vi.mock('../src/components/FounderAgentsPanel', () => ({ default: () => <div>FounderAgentsPanel</div> }));
vi.mock('../src/components/FounderOverview', () => ({ default: () => <div>FounderOverview</div> }));
vi.mock('../src/components/FounderMissionControl', () => ({ default: () => <div>FounderMissionControl</div> }));
vi.mock('../src/components/FounderQLegionPanel', () => ({ default: () => <div>FounderQLegionPanel</div> }));
vi.mock('../src/components/FounderControlPlane', () => ({ default: () => <div>FounderControlPlane</div> }));
vi.mock('../src/components/FounderFeatureControlMatrix', () => ({ default: () => <div>FounderFeatureControlMatrix</div> }));
import FounderDashboardView from '../src/components/FounderDashboardView';
afterEach(cleanup);
it('mounts only the selected panels and unmounts traffic when leaving the tab', () => {
  render(<FounderDashboardView userRole="Owner" />);
  expect(screen.getByText('FounderOverview')).toBeTruthy();
  expect(screen.queryByText('FounderControlPlane')).toBeNull();
  expect(screen.queryByText('FounderTrafficPanel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Traffic' }));
  expect(screen.getByText('FounderTrafficPanel')).toBeTruthy();
  expect(screen.queryByText('FounderOverview')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Operations & repairs' }));
  expect(screen.getByText('FounderControlPlane')).toBeTruthy();
  expect(screen.queryByText('FounderTrafficPanel')).toBeNull();
});
it('does not mount privileged panels for a viewer', () => {
  render(<FounderDashboardView userRole="Viewer" />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText('FounderOverview')).toBeNull();
});
