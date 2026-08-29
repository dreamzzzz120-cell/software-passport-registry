/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GREEN, AMBER, RED } from '../../workflows/featureColors';
import type { TrustState } from './TrustStateBadge';

const NEUTRAL = '#6f6f6f';

const STATE_COLOR: Record<TrustState, string> = {
  VERIFIED: GREEN,
  PARTIALLY_VERIFIED: AMBER,
  EVIDENCE_INCOMPLETE: NEUTRAL,
  VERIFICATION_FAILED: RED,
  UNINITIALIZED: NEUTRAL,
};

const STATE_LABEL: Record<TrustState, string> = {
  VERIFIED: 'Verified',
  PARTIALLY_VERIFIED: 'Needs Review',
  EVIDENCE_INCOMPLETE: 'Unknown',
  VERIFICATION_FAILED: 'Failed',
  UNINITIALIZED: 'Uninitialized',
};

export interface NetworkSoftwareNode {
  passportId: string;
  name: string;
  state: TrustState;
}

export interface NetworkClientNode {
  id: string;
  name: string;
  software: NetworkSoftwareNode[];
}

interface Props {
  clients: NetworkClientNode[];
  clientsOmitted: number;
  onSelectClient: (id: string) => void;
  onSelectSoftware: (passportId: string) => void;
}

const MAX_SOFTWARE_PER_CLIENT = 5;

// The real Client -> Software -> Trust State hierarchy, rendered as plain
// accessible DOM (buttons and text) rather than a force-directed graph --
// every node has a real label and a keyboard-reachable click target, and no
// relationship is drawn that the caller didn't actually pass in. `clients` is
// expected to already be capped/sorted by the caller (by risk); this
// component only ever renders what it's given, plus an honest "+N more"
// count for anything left out.
export default function TrustNetworkMap({ clients, clientsOmitted, onSelectClient, onSelectSoftware }: Props) {
  return (
    <div>
      <div className="flex flex-col items-center">
        <div className="rounded-md border border-[#3794ff]/50 bg-[#094771]/20 px-4 py-2 text-xs font-bold uppercase tracking-[.14em] text-[#3794ff]">MSP</div>
        <div className="h-6 w-px bg-[#3c3c3c]" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((client) => (
          <div key={client.id} className="flex flex-col rounded-md border border-[#3c3c3c] bg-[#1e1e1e]">
            <button
              onClick={() => onSelectClient(client.id)}
              className="flex items-center justify-between gap-2 border-b border-[#3c3c3c] bg-[#252526] px-4 py-3 text-left transition hover:bg-[#2d2d2d]"
              aria-label={`Open ${client.name}`}
            >
              <span className="truncate text-sm font-semibold text-[#d4d4d4]">{client.name}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-[#6f6f6f]">Client</span>
            </button>
            <div className="flex-1 space-y-1.5 p-3">
              {client.software.length === 0 && (
                <p className="px-1 py-2 text-xs text-[#6f6f6f]">No software registered for this client yet.</p>
              )}
              {client.software.slice(0, MAX_SOFTWARE_PER_CLIENT).map((software) => (
                <button
                  key={software.passportId}
                  onClick={() => onSelectSoftware(software.passportId)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-[#3c3c3c] bg-[#252526] px-2.5 py-1.5 text-left transition hover:border-[#6f6f6f] hover:bg-[#2d2d2d]"
                  aria-label={`Open ${software.name}, trust state ${STATE_LABEL[software.state]}`}
                >
                  <span className="truncate text-xs text-[#d4d4d4]">{software.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold" style={{ color: STATE_COLOR[software.state] }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: STATE_COLOR[software.state] }} aria-hidden="true" />
                    {STATE_LABEL[software.state]}
                  </span>
                </button>
              ))}
              {client.software.length > MAX_SOFTWARE_PER_CLIENT && (
                <p className="px-1 pt-1 text-[10px] text-[#6f6f6f]">+{client.software.length - MAX_SOFTWARE_PER_CLIENT} more software asset{client.software.length - MAX_SOFTWARE_PER_CLIENT === 1 ? '' : 's'}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {clientsOmitted > 0 && (
        <p className="mt-4 text-center text-xs text-[#6f6f6f]">+{clientsOmitted} more client{clientsOmitted === 1 ? '' : 's'} not shown here — use Switch Client or View All Clients.</p>
      )}
    </div>
  );
}
