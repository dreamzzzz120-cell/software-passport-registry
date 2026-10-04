export type VendorEvidenceRecord = {
  id?: string;
  provider?: string;
  control_id?: string;
  controlId?: string;
  subject?: string;
  source_url?: string;
  sourceUrl?: string;
  observed_at?: string;
  observedAt?: string;
  verification_method?: string;
  verificationMethod?: string;
  status?: string;
  limitation?: string;
  title?: string;
  description?: string;
  severity?: string;
};

export type VendorRequestReport = {
  generatedAt?: string;
  reportHash?: string;
  evidenceQuality?: { completenessBasisPoints?: number | null; unknownDimensions?: number; latestObservationAt?: string | null };
  evidence?: unknown[];
  findings?: unknown[];
  limitations?: Array<{ evidenceId?: string; limitation?: string }>;
  repositoryScan?: { sbomComponentCount?: number; sbomComponents?: unknown[]; findings?: unknown[]; evidence?: unknown[] };
  sbom?: unknown[];
};

export type VendorDeficit = {
  id: 'SPR-PROV-001' | 'SPR-NET-002' | 'SPR-DEP-003';
  title: string;
  status: 'UNVERIFIED' | 'INSUFFICIENTLY OBSERVED' | 'INCOMPLETE';
  whatSprChecked: string[];
  currentResult: string;
  requestedEvidence: string[];
  matchingEvidence: VendorEvidenceRecord[];
};

const text = (record: VendorEvidenceRecord) => [
  record.control_id, record.controlId, record.subject, record.provider, record.title,
  record.description, record.verification_method, record.verificationMethod, record.limitation,
].filter(Boolean).join(' ').toLowerCase();

const VERIFIED = new Set(['verified', 'pass', 'passed', 'valid', 'trusted']);
const isVerified = (record: VendorEvidenceRecord) => VERIFIED.has(String(record.status || '').toLowerCase());

function uniqueRecords(records: VendorEvidenceRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = String(record.id || JSON.stringify(record));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asRecord(value: unknown): VendorEvidenceRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as VendorEvidenceRecord : null;
}

function recordsFor(report: VendorRequestReport, pattern: RegExp) {
  const all = [
    ...(report.evidence || []),
    ...(report.findings || []),
    ...(report.repositoryScan?.evidence || []),
    ...(report.repositoryScan?.findings || []),
  ].map(asRecord).filter((record): record is VendorEvidenceRecord => Boolean(record));
  return uniqueRecords(all.filter((record) => pattern.test(text(record))));
}

export function buildVendorDeficits(report: VendorRequestReport): VendorDeficit[] {
  const provenance = recordsFor(report, /provenance|signature|signed|authenticode|certificate|publisher|attestation|release hash|sha-?256|slsa|build metadata|integrity/);
  const network = recordsFor(report, /network|outbound|domain|dns|endpoint|telemetry|analytics|crash|update service|licen[cs]ing|authentication destination|egress|tcp|udp|port/);
  const dependency = recordsFor(report, /sbom|cyclonedx|spdx|dependency|dependencies|component|package|end.of.life|unsupported|vulnerab|lifecycle/);

  const provenanceVerified = provenance.some(isVerified);
  const networkVerified = network.some(isVerified);
  const sbomCount = report.repositoryScan?.sbomComponentCount ?? report.repositoryScan?.sbomComponents?.length ?? report.sbom?.length ?? 0;
  const dependencyVerified = sbomCount > 0 && dependency.some(isVerified);

  return [
    {
      id: 'SPR-PROV-001',
      title: 'Cryptographic Signature / Software Provenance',
      status: 'UNVERIFIED',
      whatSprChecked: [
        'Available signature, certificate, release-hash, attestation, publisher, and build-provenance evidence.',
        'Evidence records attributable to the assessed artifact and release.',
        'Whether any matching provenance record is explicitly verified by SPR.',
      ],
      currentResult: provenanceVerified
        ? 'SPR has at least one verified provenance-related record, but this request remains conservative unless the complete artifact provenance chain is established. Review the cited records before sending.'
        : 'SPR did not find a verified provenance record in the evidence available to this report. This does not assert that the artifact is malicious, counterfeit, or improperly produced.',
      requestedEvidence: [
        'Authenticode, Apple code-signing, package-signing, or equivalent signature information',
        'Signing certificate details and certificate chain',
        'SHA-256 or stronger published release hashes',
        'Signed release manifest or attestation',
        'Build provenance or verifiable build metadata',
        'Documentation identifying the authorized software publisher and release process',
      ],
      matchingEvidence: provenance,
    },
    {
      id: 'SPR-NET-002',
      title: 'Network Behavior / Outbound Communication',
      status: 'INSUFFICIENTLY OBSERVED',
      whatSprChecked: [
        'Available network, endpoint, telemetry, update, licensing, authentication, and egress evidence.',
        'Whether observed destinations are attributable to documented software behavior.',
        'Whether any matching network-behavior record is explicitly verified by SPR.',
      ],
      currentResult: networkVerified
        ? 'SPR has at least one verified network-related record, but the available report does not establish that the expected network behavior is complete. Review the cited records before sending.'
        : 'SPR could not establish a sufficiently complete, verified picture of expected outbound behavior from the evidence available to this report.',
      requestedEvidence: [
        'Required outbound domains and IP ranges',
        'Required TCP/UDP ports and protocols',
        'API or cloud service endpoints contacted by the application',
        'Telemetry, analytics, crash-reporting, update, licensing, and authentication destinations',
        'Data categories transmitted externally, including customer, device, diagnostic, or identifier data',
        'Purpose of each required external connection and any dynamic hostname/discovery mechanism',
      ],
      matchingEvidence: network,
    },
    {
      id: 'SPR-DEP-003',
      title: 'Software Dependency / Component Lifecycle',
      status: 'INCOMPLETE',
      whatSprChecked: [
        'Available SBOM/component inventory and dependency-related evidence.',
        'Recorded component versions, vulnerability findings, and lifecycle signals.',
        'Whether the current report contains both an SBOM and verified dependency/lifecycle evidence.',
      ],
      currentResult: dependencyVerified
        ? `SPR observed ${sbomCount} SBOM component(s) and at least one verified dependency-related record, but the report does not independently establish that the dependency inventory and lifecycle coverage are complete. Review the cited records before sending.`
        : sbomCount > 0
          ? `SPR observed ${sbomCount} SBOM component(s), but could not verify complete dependency and lifecycle coverage from the evidence available to this report.`
          : 'SPR did not receive a component inventory in the report data sufficient to establish a complete and current dependency inventory.',
      requestedEvidence: [
        'Current SBOM, preferably CycloneDX or SPDX',
        'Direct and transitive dependency versions',
        'Component supplier or package origin where available',
        'Known end-of-life or unsupported dependencies',
        'Current vulnerability remediation information',
        'Dependency monitoring and security update process',
        'Expected support lifecycle for this software release',
      ],
      matchingEvidence: dependency,
    },
  ];
}

export function buildVendorEvidenceRequestText(input: {
  report: VendorRequestReport;
  productName: string;
  version?: string;
  clientName?: string;
  organization?: string;
  contactName?: string;
  contactEmail?: string;
}) {
  const { report } = input;
  const deficits = buildVendorDeficits(report);
  const product = [input.productName, input.version].filter(Boolean).join(' / ');
  const assessmentReference = report.reportHash || 'NOT OBSERVED';
  const lines = [
    'SOFTWARE PASSPORT REGISTRY (SPR)',
    'Vendor Evidence & Compliance Request',
    '',
    'To: Vendor Security / Engineering / Compliance Team',
    `Re: Verification Request for ${product || 'Software Product / Version not observed'}`,
    `Environment: ${input.clientName || 'NOT OBSERVED'}`,
    `SPR Assessment Reference: ${assessmentReference}`,
    `Report Generated: ${report.generatedAt || 'NOT OBSERVED'}`,
    '',
    'SPR records only evidence that can be directly observed, independently verified, or supported by attributable documentation. It does not infer that a security or compliance control exists when supporting evidence is unavailable.',
    '',
    'The following evidence deficits are generated from the currently loaded SPR report. Each section shows what SPR checked, the current evidence-limited result, and the source records SPR used.',
    '',
  ];

  for (const deficit of deficits) {
    lines.push(deficit.title.toUpperCase(), `Status: ${deficit.status}`, `Deficit ID: ${deficit.id}`, '', 'WHAT SPR CHECKED');
    deficit.whatSprChecked.forEach((item) => lines.push(`- ${item}`));
    lines.push('', 'CURRENT RESULT', deficit.currentResult, '', 'REQUESTED EVIDENCE');
    deficit.requestedEvidence.forEach((item) => lines.push(`- ${item}`));
    lines.push('', 'SPR SOURCE RECORDS');
    if (!deficit.matchingEvidence.length) {
      lines.push('- No matching evidence record was present in the loaded report.');
    } else {
      deficit.matchingEvidence.forEach((record) => {
        lines.push(`- ${record.id || 'record-id-not-returned'} | status=${record.status || 'UNKNOWN'} | source=${record.source_url || record.sourceUrl || 'NOT OBSERVED'} | observed=${record.observed_at || record.observedAt || 'NOT OBSERVED'}`);
        if (record.limitation) lines.push(`  limitation: ${record.limitation}`);
      });
    }
    lines.push('');
  }

  lines.push(
    'REQUESTED RESPONSE',
    'Please provide the requested evidence or a written explanation for any item that cannot be supplied. For each response, identify the source document, system, release, artifact, URL, or responsible team from which the answer was derived. Where possible, include machine-verifiable evidence rather than an unsupported assertion.',
    '',
    'SPR will reassess affected findings when new evidence is received. Submission does not automatically produce a passing result. Until sufficient evidence exists, affected properties remain UNVERIFIED, INCOMPLETE, INSUFFICIENTLY OBSERVED, or UNKNOWN.',
    '',
    'Evidence principle: "If we can\'t observe it, we don\'t claim it."',
    '',
    `Requested by: ${input.organization || 'NOT OBSERVED'}`,
    `Contact: ${input.contactName || 'NOT OBSERVED'}`,
    `Email: ${input.contactEmail || 'NOT OBSERVED'}`,
    '',
    'Generated through: Software Passport Registry (SPR) — Evidence-Based Software Assurance',
  );

  return lines.join('\n');
}
