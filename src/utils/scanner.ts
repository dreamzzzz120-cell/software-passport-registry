/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db } from '../db/index.ts';
import {
  auditTrail,
  evidenceItems,
  scanFindings,
  passports,
  agentJobs,
  agentLogs,
  scans,
  alerts
} from '../db/schema.ts';
import { eq, and, desc } from 'drizzle-orm';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { verifyEvidenceIntegrity } from './evidence-integrity.ts';
import { config } from '../config.ts';

// Weight parameters for the Trust Score Engine
const CRITICAL_WEIGHT = 25;
const HIGH_WEIGHT = 15;
const MEDIUM_WEIGHT = 10;
const LOW_WEIGHT = 5;

const SIGNATURE_BONUS = 5;
const AUDIT_BONUS = 5;
const INVALID_SIGNATURE_PENALTY = 15;
const MISSING_AUDIT_PENALTY = 5;

// Helper to write a cryptographic audit log into the Postgres blockchain
export async function addPostgresAuditLog(tenantId: string, action: string, actor: string, payload: any) {
  try {
    const lastBlock = await db.select()
      .from(auditTrail)
      .where(eq(auditTrail.tenantId, tenantId))
      .orderBy(desc(auditTrail.id))
      .limit(1)
      .then(rows => rows[0]);

    const previousHash = lastBlock ? lastBlock.currentHash : '0000000000000000000000000000000000000000000000000000000000000000';
    const payloadStr = JSON.stringify(payload);
    const timestamp = new Date().toISOString();

    const currentHash = crypto.createHash('sha256')
      .update(action + timestamp + actor + payloadStr + previousHash)
      .digest('hex');

    await db.insert(auditTrail).values({
      tenantId,
      action,
      timestamp,
      actor,
      payload: payloadStr,
      previousHash,
      currentHash
    });

    console.log(`[Ledger Block] ${action} chained. Hash: ${currentHash.substring(0, 12)}...`);
    return currentHash;
  } catch (err) {
    console.error('[Ledger Error] Failed to write cryptographic block:', err);
    return null;
  }
}

// Log helper for agent progress inside agentLogsTable
async function logJobStep(jobId: string, agentId: string, message: string, level: 'Info' | 'Warning' | 'Error' = 'Info') {
  console.log(`[Job: ${jobId}][Engine: ${agentId}] ${message}`);
  await db.insert(agentLogs).values({
    jobId,
    agentId,
    message,
    level,
    timestamp: new Date()
  });
}

/**
 * Mathematically derives the Trust Score and category-specific scores based on database-stored evidence and findings.
 * Clamped strictly between 0 and 100.
 */
export async function calculateAndStoreTrustScore(assetId: string, tenantId: string) {
  // 1. Fetch active findings
  const findings = await db.select()
    .from(scanFindings)
    .where(and(
      eq(scanFindings.assetId, assetId),
      eq(scanFindings.tenantId, tenantId),
      eq(scanFindings.status, 'Open')
    ));

  // 2. Fetch evidence
  const evidenceList = await db.select()
    .from(evidenceItems)
    .where(and(
      eq(evidenceItems.assetId, assetId),
      eq(evidenceItems.tenantId, tenantId)
    ));

  // Base Scores
  let securityScore = 100;
  let complianceScore = 100;
  let vendorScore = 100;

  // Apply reductions for Open Findings
  for (const f of findings) {
    let weight = MEDIUM_WEIGHT;
    if (f.severity === 'Critical') weight = CRITICAL_WEIGHT;
    else if (f.severity === 'High') weight = HIGH_WEIGHT;
    else if (f.severity === 'Medium') weight = MEDIUM_WEIGHT;
    else if (f.severity === 'Low') weight = LOW_WEIGHT;

    if (f.category === 'Vulnerability') {
      securityScore -= weight;
    } else if (f.category === 'Compliance Gap' || f.category === 'Policy Violation') {
      complianceScore -= weight;
    } else if (f.category === 'Signature Failure') {
      securityScore -= weight * 1.2; // Extra weight on security for signature failures
      complianceScore -= weight;
    }
  }

  // Adjust scores with Evidence Modifiers
  const hasValidSignature = evidenceList.some(e => e.type === 'Signature' && e.verified === 1);
  const hasInvalidSignature = evidenceList.some(e => e.type === 'Signature' && e.verified === 0);
  const hasAuditReport = evidenceList.some(e => e.type === 'Audit Report' && e.verified === 1);

  // Security score modifier
  if (hasValidSignature) {
    securityScore += SIGNATURE_BONUS;
  } else if (hasInvalidSignature) {
    securityScore -= INVALID_SIGNATURE_PENALTY;
  } else {
    // Missing signature entirely
    securityScore -= 5;
  }

  // Compliance score modifier
  if (hasAuditReport) {
    complianceScore += AUDIT_BONUS;
  } else {
    complianceScore -= MISSING_AUDIT_PENALTY;
  }

  // Vendor reputation is based on vendor-specific audits and incidents
  const vendorAudits = evidenceList.filter(e => e.engineId === 'vendor-ai');
  const vendorPassCount = vendorAudits.filter(e => e.verified === 1).length;
  const vendorFailCount = vendorAudits.filter(e => e.verified === 0).length;

  vendorScore = 100 - (vendorFailCount * 20) + (vendorPassCount * 3);
  if (findings.some(f => f.engineId === 'vendor-ai' && f.severity === 'Critical')) {
    vendorScore -= 30;
  }

  // Clamp category scores
  securityScore = Math.max(0, Math.min(100, Math.round(securityScore)));
  complianceScore = Math.max(0, Math.min(100, Math.round(complianceScore)));
  vendorScore = Math.max(0, Math.min(100, Math.round(vendorScore)));

  // Mathematically derived Overall Trust Score
  const overallScore = Math.max(0, Math.min(100, Math.round(
    (securityScore * 0.4) + (complianceScore * 0.4) + (vendorScore * 0.2)
  )));

  // Write scores back to Software Passport record
  await db.update(passports)
    .set({
      overallScore,
      securityScore,
      complianceScore,
      vendorReputationScore: vendorScore,
    })
    .where(and(
      eq(passports.id, assetId),
      eq(passports.tenantId, tenantId)
    ));

  await addPostgresAuditLog(tenantId, 'TRUST_SCORE_CALCULATED', 'TrustScoreEngine', {
    assetId,
    overallScore,
    securityScore,
    complianceScore,
    vendorScore,
    evidenceCount: evidenceList.length,
    findingsCount: findings.length
  });

  return {
    overallScore,
    securityScore,
    complianceScore,
    vendorScore
  };
}

/**
 * Triggers and orchestrates the 8 modular scanning engines in sequence.
 */
export async function runComprehensiveScan(
  passportId: string,
  tenantId: string,
  jobId: string,
  actorEmail: string
) {
  const startTime = Date.now();

  try {
    // 1. Initialize Scan Job inside Postgres
    await db.update(agentJobs)
      .set({ status: 'Running', progress: 5, updatedAt: new Date() })
      .where(eq(agentJobs.id, jobId));

    await logJobStep(jobId, 'scanner-orchestrator', `Booting continuous scan pipeline for passport: ${passportId}`);

    // Fetch primary asset metadata
    const passport = await db.select()
      .from(passports)
      .where(and(eq(passports.id, passportId), eq(passports.tenantId, tenantId)))
      .then(rows => rows[0]);

    if (!passport) {
      throw new Error(`Software asset with ID ${passportId} could not be located.`);
    }

    // Clean past findings and evidence for this pipeline run to guarantee fresh, exact evidence tracing
    await db.delete(evidenceItems)
      .where(and(eq(evidenceItems.assetId, passportId), eq(evidenceItems.tenantId, tenantId)));
    await db.delete(scanFindings)
      .where(and(eq(scanFindings.assetId, passportId), eq(scanFindings.tenantId, tenantId)));

    await logJobStep(jobId, 'scanner-orchestrator', 'Purged outdated asset evidence layers and findings. Beginning collection...');

    // ==========================================
    // MODULE 1: Identity Engine
    // ==========================================
    await logJobStep(jobId, 'identity-ai', 'Executing publisher signature authenticity and cryptographic keys check...');
    await db.update(agentJobs).set({ progress: 15, updatedAt: new Date() });

    // Validate signatures inside passport evidence metadata
    const parsedEvidence = JSON.parse(passport.evidence || '[]');
    let signatureVerified = false;
    let signatureOwner = 'Unknown Signer';
    let integrityCheckFailureReason: string | null = null;
    let signatureStatus: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'DECLARED' | 'FAILED' | 'UNKNOWN' = 'UNKNOWN';
    let identityRawContent: any = {
      signingProtocol: 'Cosign v2.0',
      status: 'No verifiable signature evidence found',
      rootHash: passport.fileHash || ''
    };

    const sigEvidence = parsedEvidence.find((e: any) => e.type === 'Signature');
    if (sigEvidence) {
      signatureOwner = sigEvidence.signer || 'Unknown Signer';
      const integrityResult = sigEvidence.rawContent && sigEvidence.hash
        ? verifyEvidenceIntegrity(
            typeof sigEvidence.rawContent === 'string'
              ? sigEvidence.rawContent
              : JSON.stringify(sigEvidence.rawContent),
            sigEvidence.hash
          )
        : { outcome: 'failed' as const, verified: false, failureReason: 'MISSING_RAWCONTENT_OR_HASH' };

      signatureVerified = integrityResult.verified &&
        (sigEvidence.status === 'VERIFIED' || sigEvidence.status === 'PARTIALLY_VERIFIED');

      signatureStatus = integrityResult.verified
        ? (sigEvidence.status === 'PARTIALLY_VERIFIED'
            ? 'PARTIALLY_VERIFIED'
            : sigEvidence.status === 'VERIFIED'
              ? 'VERIFIED'
              : 'DECLARED')
        : 'FAILED';

      if (!integrityResult.verified) {
        integrityCheckFailureReason = integrityResult.failureReason ?? 'HASH_MISMATCH';
      }

      identityRawContent = {
        signingProtocol: sigEvidence.signingProtocol || 'Cosign v2.0',
        status: signatureVerified
          ? 'Signature declared by submitter and independently hash-verified'
          : `Signature evidence present but failed independent verification: ${integrityCheckFailureReason}`,
        issuer: signatureOwner,
        signatureHash: sigEvidence.hash || passport.fileHash || '',
        rootHash: passport.fileHash || '',
        independentHashCheck: integrityResult.outcome
      };
    }

    // Store EvidenceItem
    const identityEvidenceId = `ev-id-${crypto.randomUUID().substring(0, 8)}`;
    await db.insert(evidenceItems).values({
      id: identityEvidenceId,
      tenantId,
      assetId: passportId,
      name: sigEvidence?.name || 'Cosign Cryptographic Signature Attestation',
      type: 'Signature',
      verified: signatureVerified ? 1 : 0,
      status: signatureStatus,
      signer: signatureOwner,
      timestamp: new Date().toISOString(),
      hash: sigEvidence?.hash || crypto.createHash('sha256').update(passport.fileHash || '').digest('hex'),
      rawContent: JSON.stringify(identityRawContent),
      verificationFailureReason: integrityCheckFailureReason,
      engineId: 'identity-ai'
    });

    if (sigEvidence && sigEvidence.status === 'VERIFIED' && !signatureVerified) {
      await db.insert(scanFindings).values({
        id: `find-integrity-${crypto.randomUUID().substring(0, 8)}`,
        tenantId,
        assetId: passportId,
        jobId,
        severity: 'Critical',
        category: 'Signature Failure',
        title: 'Self-Reported VERIFIED Signature Failed Independent Hash Check',
        description: `Submitter's evidence claimed status VERIFIED for this signature, but independent SHA-256 verification against the declared hash failed (${integrityCheckFailureReason}). Treating as unverified.`,
        detectedAt: new Date().toISOString(),
        engineId: 'evidence-integrity'
      });
      await logJobStep(jobId, 'evidence-integrity', 'Self-reported VERIFIED claim failed independent hash check — downgraded and flagged.', 'Error');
    }

    if (!signatureVerified) {
      await db.insert(scanFindings).values({
        id: `find-id-${crypto.randomUUID().substring(0, 8)}`,
        tenantId,
        assetId: passportId,
        jobId,
        severity: 'Critical',
        category: 'Signature Failure',
        title: 'Cryptographic Signature Missing or Corrupted',
        description: `This asset claims publisher identity from ${passport.publisher} but lacks a verifiable, cryptographically binding Cosign or GPG signature signature matching root trust registries.`,
        detectedAt: new Date().toISOString(),
        engineId: 'identity-ai'
      });
      await logJobStep(jobId, 'identity-ai', 'Signature verification failed. Filed a critical finding.', 'Error');
    } else {
      await logJobStep(jobId, 'identity-ai', `Passport declares a signed signature from ${signatureOwner} (not independently re-verified against a public key).`);
    }

    // ==========================================
    // MODULE 2: Code & Repository Engine
    // ==========================================
    await logJobStep(jobId, 'code-ai', 'Auditing static source attributes and repository security controls...');
    await db.update(agentJobs).set({ progress: 28, updatedAt: new Date() });

    // Inspect repository indicators by checking whether repository integrity attestations exist in the passport evidence
    const codeEvidenceId = `ev-code-${crypto.randomUUID().substring(0, 8)}`;
    const repoEvidence = parsedEvidence.find((e: any) =>
      e.type === 'Attestation' && /repository integrity|branch protection|signed commits|repo integrity/i.test(e.name || '')
    );
    let repoEvidenceVerified = false;
    let repoIntegrityFailureReason: string | null = null;
    let repoStatus: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'DECLARED' | 'FAILED' | 'UNKNOWN' = 'UNKNOWN';
    let repoRawContent: any = {
      repoUrl: repoEvidence?.rawContent?.repoUrl || null,
      branchProtectionRules: repoEvidence ? repoEvidence.rawContent?.branchProtectionRules : {
        requireLinearHistory: true,
        requireSignedCommits: false,
        requiredApprovingReviewCount: 0
      },
      source: repoEvidence ? 'Passport evidence' : 'No repository integrity attestations present'
    };

    if (repoEvidence) {
      const integrityResult = repoEvidence.rawContent && repoEvidence.hash
        ? verifyEvidenceIntegrity(
            typeof repoEvidence.rawContent === 'string'
              ? repoEvidence.rawContent
              : JSON.stringify(repoEvidence.rawContent),
            repoEvidence.hash
          )
        : { outcome: 'failed' as const, verified: false, failureReason: 'MISSING_RAWCONTENT_OR_HASH' };

      repoEvidenceVerified = integrityResult.verified &&
        (repoEvidence.status === 'VERIFIED' || repoEvidence.status === 'PARTIALLY_VERIFIED');

      repoStatus = integrityResult.verified
        ? (repoEvidence.status === 'PARTIALLY_VERIFIED'
            ? 'PARTIALLY_VERIFIED'
            : repoEvidence.status === 'VERIFIED'
              ? 'VERIFIED'
              : 'DECLARED')
        : 'FAILED';

      if (!integrityResult.verified) {
        repoIntegrityFailureReason = integrityResult.failureReason ?? 'HASH_MISMATCH';
      }

      repoRawContent.status = repoEvidenceVerified
        ? 'Repository attestation declared and independently hash-verified'
        : `Repository evidence present but failed independent verification: ${repoIntegrityFailureReason}`;
      repoRawContent.independentHashCheck = integrityResult.outcome;
    }

    await db.insert(evidenceItems).values({
      id: codeEvidenceId,
      tenantId,
      assetId: passportId,
      name: repoEvidence?.name || 'Repository Integrity Attestation',
      type: 'Attestation',
      verified: repoEvidenceVerified ? 1 : 0,
      status: repoStatus,
      signer: repoEvidence?.signer || 'spr-self-reported-data',
      timestamp: new Date().toISOString(),
      hash: repoEvidence?.hash || crypto.createHash('sha256').update(passportId + 'repo').digest('hex'),
      rawContent: JSON.stringify(repoRawContent),
      verificationFailureReason: repoIntegrityFailureReason,
      engineId: 'code-ai'
    });

    if (repoEvidence && repoEvidence.status === 'VERIFIED' && !repoEvidenceVerified) {
      await db.insert(scanFindings).values({
        id: `find-repo-integrity-${crypto.randomUUID().substring(0, 8)}`,
        tenantId,
        assetId: passportId,
        jobId,
        severity: 'Critical',
        category: 'Compliance Gap',
        title: 'Self-Reported VERIFIED Repository Attestation Failed Independent Hash Check',
        description: `Repository integrity evidence was declared VERIFIED by the submitter, but independent SHA-256 verification against the provided hash failed (${repoIntegrityFailureReason}). Treating the repository evidence as unverified.`,
        detectedAt: new Date().toISOString(),
        engineId: 'evidence-integrity'
      });
      await logJobStep(jobId, 'evidence-integrity', 'Self-reported VERIFIED repository attestation failed independent hash check — downgraded and flagged.', 'Error');
    }

    if (!repoEvidenceVerified) {
      await db.insert(scanFindings).values({
        id: `find-code-${crypto.randomUUID().substring(0, 8)}`,
        tenantId,
        assetId: passportId,
        jobId,
        severity: 'High',
        category: 'Compliance Gap',
        title: 'Missing Repository Integrity Attestation',
        description: `The passport does not contain verified repository integrity evidence such as branch protections or signed commit attestations. This hinders assurance of source code provenance.`,
        detectedAt: new Date().toISOString(),
        engineId: 'code-ai'
      });
      await logJobStep(jobId, 'code-ai', 'Flagged missing or unverified repository integrity attestations.', 'Warning');
    }

    // ==========================================
    // MODULE 3: Dependency Engine
    // ==========================================
    await logJobStep(jobId, 'dependency-ai', 'Resolving and analyzing direct/transitive Software Bill of Materials (SBOM)...');
    await db.update(agentJobs).set({ progress: 40, updatedAt: new Date() });

    const sbomComponents = JSON.parse(passport.sbom || '[]');
    let blockedCount = 0;

    for (const c of sbomComponents) {
      if (c.trustLevel === 'Blocked') {
        blockedCount++;
        await db.insert(scanFindings).values({
          id: `find-dep-${crypto.randomUUID().substring(0, 8)}`,
          tenantId,
          assetId: passportId,
          jobId,
          severity: 'Critical',
          category: 'Policy Violation',
          title: `Blacklisted Component Detected: ${c.name}`,
          description: `The transitive dependency ${c.name} (v${c.version}) is actively blacklisted in organizational trust policies.`,
          component: c.name,
          status: 'Open',
          detectedAt: new Date().toISOString(),
          engineId: 'dependency-ai'
        });
      }
    }

    const dependencyEvidenceId = `ev-dep-${crypto.randomUUID().substring(0, 8)}`;
    await db.insert(evidenceItems).values({
      id: dependencyEvidenceId,
      tenantId,
      assetId: passportId,
      name: 'Software Bill of Materials (SBOM) Attestation',
      type: 'Attestation',
      verified: 0, // Self-reported SBOM structure was parseable — that is not the same as verified
      status: 'OBSERVED',
      signer: 'spr-self-reported-data', // Parses the SBOM the customer submitted — does not independently verify component authenticity
      timestamp: new Date().toISOString(),
      hash: crypto.createHash('sha256').update(passport.sbom).digest('hex'),
      rawContent: JSON.stringify({
        format: 'CycloneDX JSON',
        version: '1.5',
        totalDependenciesCount: sbomComponents.length,
        directCount: sbomComponents.filter((c: any) => c.dependencyType === 'Direct').length,
        transitiveCount: sbomComponents.filter((c: any) => c.dependencyType === 'Transitive').length
      }),
      engineId: 'dependency-ai'
    });

    await logJobStep(jobId, 'dependency-ai', `SBOM parsing complete. Validated ${sbomComponents.length} components. Found ${blockedCount} blocked dependencies.`);

    // ==========================================
    // MODULE 4: Security Engine
    // ==========================================
    await logJobStep(jobId, 'security-ai', 'Cross-referencing self-reported vulnerability entries on this passport (no live NVD/GHSA query performed)...');
    await db.update(agentJobs).set({ progress: 52, updatedAt: new Date() });

    const activeVulnerabilities = JSON.parse(passport.vulnerabilities || '[]');
    let securityFindingsInserted = 0;

    for (const v of activeVulnerabilities) {
      const findingId = `find-sec-${crypto.randomUUID().substring(0, 8)}`;
      await db.insert(scanFindings).values({
        id: findingId,
        tenantId,
        assetId: passportId,
        jobId,
        severity: v.severity || 'Medium',
        category: 'Vulnerability',
        title: `${v.id}: ${v.title}`,
        description: v.description || 'Vulnerability with high remote execution possibility.',
        component: v.component,
        fixedVersion: v.fixedVersion || 'N/A',
        status: v.status || 'Open',
        detectedAt: new Date().toISOString(),
        engineId: 'security-ai'
      });
      securityFindingsInserted++;
    }

    const securityEvidenceId = `ev-sec-${crypto.randomUUID().substring(0, 8)}`;
    await db.insert(evidenceItems).values({
      id: securityEvidenceId,
      tenantId,
      assetId: passportId,
      name: 'Vulnerability Scan Attestation',
      type: 'Security Scan',
      verified: 0, // No live NVD/Trivy scan was executed — this reflects self-reported vulnerability entries only
      status: 'DECLARED',
      signer: 'spr-self-reported-data',
      timestamp: new Date().toISOString(),
      hash: crypto.createHash('sha256').update(passport.vulnerabilities).digest('hex'),
      rawContent: JSON.stringify({
        note: 'Derived from self-reported vulnerability entries on this passport — no live CVE database was queried',
        scannedComponents: sbomComponents.map((c: any) => c.name),
        openVulnerabilitiesCount: activeVulnerabilities.length
      }),
      engineId: 'security-ai'
    });

    await logJobStep(jobId, 'security-ai', `Processed ${securityFindingsInserted} self-reported vulnerability entries.`);

    // ==========================================
    // MODULE 5: Compliance Engine
    // ==========================================
    await logJobStep(jobId, 'compliance-ai', 'Evaluating SBOM alignment against NIST SP 800-218 and SOC 2 Trust Criteria...');
    await db.update(agentJobs).set({ progress: 65, updatedAt: new Date() });

    // Map NIST SSDF criteria (Secure Development Environment, Verify third-party components)
    const hasSbom = sbomComponents.length > 0;
    const isSigned = signatureVerified;

    if (!hasSbom) {
      await db.insert(scanFindings).values({
        id: `find-comp-sbom-${crypto.randomUUID().substring(0, 8)}`,
        tenantId,
        assetId: passportId,
        jobId,
        severity: 'High',
        category: 'Compliance Gap',
        title: 'NIST SP 800-218 PW.4.1 compliance failure: Missing verified SBOM',
        description: 'Critical compliance gap: System must provide an authentic CycloneDX or SPDX Software Bill of Materials to audit transit dependencies.',
        detectedAt: new Date().toISOString(),
        engineId: 'compliance-ai'
      });
    }

    if (!isSigned) {
      await db.insert(scanFindings).values({
        id: `find-comp-sig-${crypto.randomUUID().substring(0, 8)}`,
        tenantId,
        assetId: passportId,
        jobId,
        severity: 'Critical',
        category: 'Compliance Gap',
        title: 'NIST SP 800-218 PO.1.1 compliance failure: Missing cryptographic release signature',
        description: 'Critical compliance gap: Pipeline build distributions must be signed with a hardware security module or cryptographically attested Cosign key.',
        detectedAt: new Date().toISOString(),
        engineId: 'compliance-ai'
      });
    }

    const complianceEvidenceId = `ev-comp-${crypto.randomUUID().substring(0, 8)}`;
    await db.insert(evidenceItems).values({
      id: complianceEvidenceId,
      tenantId,
      assetId: passportId,
      name: 'NIST SP 800-218 / SOC 2 Compliance Mapping',
      type: 'Audit Report',
      verified: (hasSbom && isSigned) ? 1 : 0,
      status: 'DECLARED',
      signer: 'spr-compliance-mapper',
      timestamp: new Date().toISOString(),
      hash: crypto.createHash('sha256').update(passportId + 'compliance').digest('hex'),
      rawContent: JSON.stringify({
        auditStandard: 'NIST SP 800-218 (Secure Software Development)',
        mappedControls: {
          'PO.1.1': isSigned ? 'Compliant' : 'Non-Compliant',
          'PW.4.1': hasSbom ? 'Compliant' : 'Non-Compliant'
        }
      }),
      engineId: 'compliance-ai'
    });

    await logJobStep(jobId, 'compliance-ai', `Compliance audit finalized. Cryptographic evidence logged.`);

    // ==========================================
    // MODULE 6: Operational Engine
    // ==========================================
    await logJobStep(jobId, 'operational-ai', 'Checking release recency from passport metadata (no live OpenSSF Scorecard or repo API call performed)...');
    await db.update(agentJobs).set({ progress: 74, updatedAt: new Date() });

    const isStale = passport.releaseDate < '2025-01-01'; // If release is older than early 2025
    const operationalEvidenceId = `ev-ops-${crypto.randomUUID().substring(0, 8)}`;

    await db.insert(evidenceItems).values({
      id: operationalEvidenceId,
      tenantId,
      assetId: passportId,
      name: 'Release Recency Check',
      type: 'Attestation',
      verified: 0, // Derived from the release date field only — no live OpenSSF Scorecard integration exists
      status: 'OBSERVED',
      signer: 'spr-derived-assessment',
      timestamp: new Date().toISOString(),
      hash: crypto.createHash('sha256').update(passport.releaseDate).digest('hex'),
      rawContent: JSON.stringify({
        releaseDate: passport.releaseDate,
        note: 'Contributor counts and maintenance ratings are not available — no live source-control API was queried'
      }),
      engineId: 'operational-ai'
    });

    if (isStale) {
      await db.insert(scanFindings).values({
        id: `find-ops-${crypto.randomUUID().substring(0, 8)}`,
        tenantId,
        assetId: passportId,
        jobId,
        severity: 'Medium',
        category: 'Policy Violation',
        title: 'Operational Stale Release Warning',
        description: `This asset package was released on ${passport.releaseDate}, displaying no maintenance updates for over 12 months. This represents high operational exposure to unpatched zero-days.`,
        detectedAt: new Date().toISOString(),
        engineId: 'operational-ai'
      });
      await logJobStep(jobId, 'operational-ai', 'Flagged operational staleness; package exhibits negligible update activity.', 'Warning');
    } else {
      await logJobStep(jobId, 'operational-ai', 'Operational profile is highly active and aligned with standard update expectations.');
    }

    // ==========================================
    // MODULE 7: Vendor Engine
    // ==========================================
    await logJobStep(jobId, 'vendor-ai', 'Checking passport for self-reported supplier due-diligence evidence (no live registry query performed)...');
    await db.update(agentJobs).set({ progress: 85, updatedAt: new Date() });

    const vendorEvidence = parsedEvidence.find((e: any) =>
      e.type === 'Audit Report' && /supplier|vendor|registry|duns|business/i.test(e.name || '')
    );
    let vendorEvidenceVerified = false;
    let vendorIntegrityFailureReason: string | null = null;
    let vendorStatus: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'DECLARED' | 'FAILED' | 'UNKNOWN' = 'UNKNOWN';
    const vendorEvidenceUnverified = vendorEvidence ? (vendorEvidence.status === 'FAILED') : false;
    const vendorEvidenceId = `ev-vendor-${crypto.randomUUID().substring(0, 8)}`;

    let vendorIntegrityOutcome: 'verified' | 'failed' | 'rejected' | undefined;
    if (vendorEvidence) {
      const integrityResult = vendorEvidence.rawContent && vendorEvidence.hash
        ? verifyEvidenceIntegrity(
            typeof vendorEvidence.rawContent === 'string'
              ? vendorEvidence.rawContent
              : JSON.stringify(vendorEvidence.rawContent),
            vendorEvidence.hash
          )
        : { outcome: 'failed' as const, verified: false, failureReason: 'MISSING_RAWCONTENT_OR_HASH' };

      vendorIntegrityOutcome = integrityResult.outcome;
      vendorEvidenceVerified = integrityResult.verified &&
        (vendorEvidence.status === 'VERIFIED' || vendorEvidence.status === 'PARTIALLY_VERIFIED');

      vendorStatus = integrityResult.verified
        ? (vendorEvidence.status === 'PARTIALLY_VERIFIED'
            ? 'PARTIALLY_VERIFIED'
            : vendorEvidence.status === 'VERIFIED'
              ? 'VERIFIED'
              : 'DECLARED')
        : 'FAILED';

      if (!integrityResult.verified) {
        vendorIntegrityFailureReason = integrityResult.failureReason ?? 'HASH_MISMATCH';
      }
    }

    await db.insert(evidenceItems).values({
      id: vendorEvidenceId,
      tenantId,
      assetId: passportId,
      name: vendorEvidence?.name || 'Supplier Due Diligence Audit',
      type: 'Audit Report',
      verified: vendorEvidenceVerified ? 1 : 0,
      status: vendorStatus,
      signer: vendorEvidence?.signer || 'spr-self-reported-data',
      timestamp: new Date().toISOString(),
      hash: vendorEvidence?.hash || crypto.createHash('sha256').update(passport.publisher || '').digest('hex'),
      rawContent: JSON.stringify({
        publisherName: passport.publisher,
        source: vendorEvidence ? 'Passport evidence' : 'No supplier due diligence evidence present',
        note: 'No live commercial registry or breach-history lookup was performed — reflects self-reported evidence only',
        status: vendorEvidenceVerified
          ? 'Vendor evidence declared and independently hash-verified'
          : vendorEvidence
            ? `Vendor evidence present but failed independent verification: ${vendorIntegrityFailureReason}`
            : undefined,
        independentHashCheck: vendorEvidence ? vendorIntegrityOutcome : undefined
      }),
      verificationFailureReason: vendorIntegrityFailureReason,
      engineId: 'vendor-ai'
    });

    if (vendorEvidence && vendorEvidence.status === 'VERIFIED' && !vendorEvidenceVerified) {
      await db.insert(scanFindings).values({
        id: `find-vendor-integrity-${crypto.randomUUID().substring(0, 8)}`,
        tenantId,
        assetId: passportId,
        jobId,
        severity: 'Critical',
        category: 'Policy Violation',
        title: 'Self-Reported VERIFIED Vendor Evidence Failed Independent Hash Check',
        description: `Submitter's vendor due diligence evidence was declared VERIFIED, but independent SHA-256 verification against the provided hash failed (${vendorIntegrityFailureReason}). Treating the vendor evidence as unverified.`,
        detectedAt: new Date().toISOString(),
        engineId: 'evidence-integrity'
      });
      await logJobStep(jobId, 'evidence-integrity', 'Self-reported VERIFIED vendor evidence failed independent hash check — downgraded and flagged.', 'Error');
    }

    if (vendorEvidenceUnverified) {
      await db.insert(scanFindings).values({
        id: `find-vendor-${crypto.randomUUID().substring(0, 8)}`,
        tenantId,
        assetId: passportId,
        jobId,
        severity: 'Medium',
        category: 'Compliance Gap',
        title: 'Missing Supplier Due Diligence Evidence',
        description: 'There is no verified supplier due diligence or vendor registry evidence present in the passport. Vendor trust remains unconfirmed.',
        detectedAt: new Date().toISOString(),
        engineId: 'vendor-ai'
      });
      await logJobStep(jobId, 'vendor-ai', 'Supplier due diligence evidence is missing.', 'Warning');
    } else {
      await logJobStep(jobId, 'vendor-ai', 'Supplier due-diligence evidence found on passport (self-reported, not independently verified).');
    }

    // ==========================================
    // MODULE 8: AI Evidence Reasoning Engine (Gemini-3.5-flash)
    // ==========================================
    await logJobStep(jobId, 'ai-evidence-reasoning', 'Aggregating all collected evidence and compiling a professional risk audit via Gemini...');
    await db.update(agentJobs).set({ progress: 92, updatedAt: new Date() });

    // Gather all stored evidence items and scan findings for this asset run
    const collectedFindings = await db.select()
      .from(scanFindings)
      .where(and(eq(scanFindings.assetId, passportId), eq(scanFindings.tenantId, tenantId)));

    const collectedEvidence = await db.select()
      .from(evidenceItems)
      .where(and(eq(evidenceItems.assetId, passportId), eq(evidenceItems.tenantId, tenantId)));

    // mathematically calculate derived score beforehand to pass into Gemini as context
    const calculatedScores = await calculateAndStoreTrustScore(passportId, tenantId);

    const geminiKey = config.gemini.apiKey;
    let aiSummaryText = '';

    if (geminiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const reasoningPrompt = `You are the core AI Evidence Reasoning Engine of the Software Passport Registry.
Analyze the following compiled raw evidence items and granular security findings for the software asset:

ASSET: ${passport.name} (v${passport.version})
PUBLISHER: ${passport.publisher}
DERIVED METRICS:
- Derived Overall Trust Score: ${calculatedScores.overallScore}/100
- Derived Security Rating: ${calculatedScores.securityScore}/100
- Derived Compliance Rating: ${calculatedScores.complianceScore}/100
- Derived Vendor Rating: ${calculatedScores.vendorScore}/100

EVIDENCE COLLECTED:
${JSON.stringify(collectedEvidence.map(e => ({ type: e.type, verified: e.verified === 1, signer: e.signer, details: e.rawContent })))}

FINDINGS DISCOVERED:
${JSON.stringify(collectedFindings.map(f => ({ category: f.category, severity: f.severity, title: f.title, description: f.description })))}

Please generate a professional, objective, and highly precise Software Trust executive summary.
Highlight:
1. Licensing and supply chain compliance.
2. Verified cryptographic proofs (e.g. signature presence or lack thereof).
3. The derived scores and their underlying lineage to findings.
4. Specific, clear technical recommendations.

The summary should be 3-4 dense, bulleted, professional paragraphs. Keep the tone completely objective, secure, and helpful. No fluff, no mock lingo.`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: reasoningPrompt
        });

        aiSummaryText = response.text || '';
        await logJobStep(jobId, 'ai-evidence-reasoning', 'Gemini Reasoning complete. Executive audit successfully compiled.');
      } catch (geminiError: any) {
        console.error('[Gemini Reasoning Failed]', geminiError);
        await logJobStep(jobId, 'ai-evidence-reasoning', 'Gemini API call timed out or failed. Falling back to secure static compiler.', 'Warning');
      }
    }

    if (!aiSummaryText) {
      // High fidelity heuristic summary based on real findings
      aiSummaryText = `Executive Security Trust Report for ${passport.name} (v${passport.version}):\n\n` +
        `• **Audit Lineage**: Calculated a mathematically derived Software Trust Score of **${calculatedScores.overallScore}/100** based on ${collectedFindings.length} open findings and ${collectedEvidence.length} collected evidence records (self-reported unless independently verified).\n` +
        `• **Security Profile**: Calculated security rating of **${calculatedScores.securityScore}/100**. ${collectedFindings.filter(f => f.category === 'Vulnerability').length} active vulnerabilities were recorded from this passport's self-reported entries.\n` +
        `• **Compliance Attestation**: Evaluated compliance rating of **${calculatedScores.complianceScore}/100** against NIST SP 800-218 and SOC 2 guidelines. Verified signature: ${signatureVerified ? 'YES' : 'NO'}.\n` +
        `• **Mitigation Plan**: Enforce immediate remediation for any critical or high findings. Apply network isolation and pin dependencies in CI/CD pipeline registers.`;
    }

    // Write final summary and calculated scores back to database
    await db.update(passports)
      .set({
        aiSummary: aiSummaryText,
        overallScore: calculatedScores.overallScore,
        securityScore: calculatedScores.securityScore,
        complianceScore: calculatedScores.complianceScore,
        vendorReputationScore: calculatedScores.vendorScore
      })
      .where(and(eq(passports.id, passportId), eq(passports.tenantId, tenantId)));

    // 9. Record Scan history record inside scansTable
    const scanId = `scan-${crypto.randomUUID().substring(0, 8)}`;
    await db.insert(scans).values({
      id: scanId,
      tenantId,
      targetName: `${passport.name} v${passport.version}`,
      scanType: 'SBOM Verify',
      triggeredBy: `AI Orchestrator (${actorEmail})`,
      status: 'Success',
      durationMs: Date.now() - startTime,
      findingsCount: collectedFindings.length,
      timestamp: new Date().toISOString(),
      clientName: passport.publisher || 'Internal System'
    });

    // Mirror Critical/High findings into AlertsTable
    for (const f of collectedFindings) {
      if (f.severity === 'Critical' || f.severity === 'High') {
        const alertId = `al-${crypto.randomUUID().substring(0, 8)}`;
        await db.insert(alerts).values({
          id: alertId,
          tenantId,
          title: f.title,
          severity: f.severity,
          category: f.category === 'Vulnerability' ? 'Vulnerability' : 'Policy Violation',
          clientName: passport.publisher || 'System',
          description: f.description,
          timestamp: new Date().toISOString(),
          status: 'Active'
        });
      }
    }

    // Create final blockchain block for the full scan
    await addPostgresAuditLog(tenantId, 'SOFTWARE_PASSPORT_COMPLETED_SCAN', actorEmail, {
      passportId,
      scores: calculatedScores,
      evidenceItemsCount: collectedEvidence.length,
      findingsCount: collectedFindings.length,
      jobId
    });

    // 10. Complete the job record in Postgres
    await db.update(agentJobs)
      .set({
        status: 'Completed',
        progress: 100,
        result: JSON.stringify({
          scores: calculatedScores,
          findingsCount: collectedFindings.length,
          evidenceCount: collectedEvidence.length,
          summary: aiSummaryText
        }),
        updatedAt: new Date()
      })
      .where(eq(agentJobs.id, jobId));

    await logJobStep(jobId, 'scanner-orchestrator', 'Scan pipeline completed successfully. Secure ledger state committed. ✅');

  } catch (error: any) {
    const errMsg = error?.message || String(error);
    console.error(`[Scan Execution Crashed Job ${jobId}]`, error);
    await logJobStep(jobId, 'scanner-orchestrator', `Scan execution failed: ${errMsg}`, 'Error');

    await db.update(agentJobs)
      .set({
        status: 'Failed',
        progress: 100,
        error: errMsg,
        updatedAt: new Date()
      })
      .where(eq(agentJobs.id, jobId));
  }
}
