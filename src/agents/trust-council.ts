/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Trust Council: a panel of specialist reviewers, each a separate Claude
 * call over the SAME read-only evidence snapshot, followed by a chair that
 * synthesises their reviews into one verdict. It exists so that a buyer can
 * see four independent readings of the evidence rather than one summary.
 *
 * Boundaries, identical to every other AI surface in SPR:
 *   - each reviewer may only cite ids that appear in the snapshot; a review
 *     that cites anything else is discarded and reported as discarded;
 *   - a verdict is never written to passports, findings or scores -- it is
 *     stored as its own record with provenance and shown as non-authoritative;
 *   - with no evidence, the only possible verdict is INSUFFICIENT_EVIDENCE.
 *
 * Everything here is pure: it takes a snapshot and a `ask` function and
 * returns a result. The route owns the database and the model client.
 */

import { z } from 'zod';

export const COUNCIL_SEATS = [
  { id: 'security', title: 'Security reviewer', focus: 'open vulnerabilities, severity, exploitability signals, fixed versions, secrets and configuration findings' },
  { id: 'supply_chain', title: 'Supply-chain & licensing reviewer', focus: 'SBOM completeness, dependency provenance, licence signals, signature and attestation evidence' },
  { id: 'vendor', title: 'Vendor & provenance reviewer', focus: 'publisher identity, repository ownership, maintenance signals, vendor due-diligence evidence and its verification status' },
  { id: 'evidence_quality', title: 'Evidence-quality reviewer', focus: 'how much of the evidence is independently verified versus self-reported, freshness, coverage gaps and what remains unknown' },
] as const;
export type CouncilSeatId = typeof COUNCIL_SEATS[number]['id'];

export const VERDICTS = ['APPROVE', 'CONDITIONAL', 'REJECT', 'INSUFFICIENT_EVIDENCE'] as const;
export type Verdict = typeof VERDICTS[number];

export const reviewSchema = z.object({
  verdict: z.enum(VERDICTS),
  rationale: z.string().trim().min(1).max(2500),
  concerns: z.array(z.object({ statement: z.string().trim().min(1).max(600), severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']), evidenceIds: z.array(z.string().trim().min(1).max(200)).max(30) }).strict()).max(15),
  unknowns: z.array(z.string().trim().min(1).max(600)).max(15),
  citedIds: z.array(z.string().trim().min(1).max(200)).max(100),
}).strict();
export type CouncilReview = z.infer<typeof reviewSchema>;

export const chairSchema = z.object({
  verdict: z.enum(VERDICTS),
  summary: z.string().trim().min(1).max(3000),
  conditions: z.array(z.string().trim().min(1).max(600)).max(15),
  disagreements: z.array(z.string().trim().min(1).max(600)).max(10),
  citedIds: z.array(z.string().trim().min(1).max(200)).max(100),
}).strict();
export type ChairSynthesis = z.infer<typeof chairSchema>;

export const REVIEW_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdict', 'rationale', 'concerns', 'unknowns', 'citedIds'],
  properties: {
    verdict: { type: 'string', enum: [...VERDICTS] },
    rationale: { type: 'string' },
    concerns: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['statement', 'severity', 'evidenceIds'], properties: { statement: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'informational'] }, evidenceIds: { type: 'array', items: { type: 'string' } } } } },
    unknowns: { type: 'array', items: { type: 'string' } },
    citedIds: { type: 'array', items: { type: 'string' } },
  },
};

export const CHAIR_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdict', 'summary', 'conditions', 'disagreements', 'citedIds'],
  properties: {
    verdict: { type: 'string', enum: [...VERDICTS] },
    summary: { type: 'string' },
    conditions: { type: 'array', items: { type: 'string' } },
    disagreements: { type: 'array', items: { type: 'string' } },
    citedIds: { type: 'array', items: { type: 'string' } },
  },
};

export interface SeatOutcome {
  seat: CouncilSeatId;
  title: string;
  status: 'reviewed' | 'discarded' | 'failed';
  review: CouncilReview | null;
  /** Why a review was discarded or failed; never hidden. */
  reason: string | null;
}

export interface CouncilResult {
  verdict: Verdict;
  chair: ChairSynthesis | null;
  seats: SeatOutcome[];
  evidenceCount: number;
  findingCount: number;
  /** Ids referenced by any accepted review or the chair, all verified against the snapshot. */
  citedIds: string[];
  policy: string;
}

export const COUNCIL_POLICY = 'Trust Council output is AI explanation over the supplied evidence snapshot only. It is not authoritative: SPR trust state remains determined by observed evidence and deterministic scoring. Any review that cited an id not in the snapshot was discarded.';

export function reviewerSystemPrompt(seat: typeof COUNCIL_SEATS[number], rules: string): string {
  return [
    `You are the ${seat.title} on the Software Passport Registry Trust Council.`,
    `Your focus: ${seat.focus}.`,
    rules,
    'Give a verdict from your seat\'s point of view only: APPROVE (nothing in your area blocks adoption), CONDITIONAL (adoption is reasonable if the listed concerns are addressed), REJECT (a concern in your area blocks adoption on the evidence), or INSUFFICIENT_EVIDENCE (the snapshot does not contain enough to judge your area).',
    'If the snapshot contains no evidence and no findings, the verdict must be INSUFFICIENT_EVIDENCE.',
  ].join('\n');
}

export function chairSystemPrompt(rules: string): string {
  return [
    'You are the Chair of the Software Passport Registry Trust Council.',
    rules,
    'You receive the reviews of the seated reviewers. Synthesise them into one verdict and summary. Where reviewers disagree, say so explicitly in disagreements rather than papering over it. The overall verdict may not be more favourable than the least favourable reviewer verdict unless you state in disagreements why that reviewer\'s concern is outweighed by evidence in the snapshot.',
    'Conditions are concrete, evidence-grounded actions that would move the verdict to APPROVE.',
  ].join('\n');
}

/** Removes any review whose citations fall outside the snapshot; reports it. */
export function acceptReview(seat: typeof COUNCIL_SEATS[number], raw: unknown, allowedIds: ReadonlySet<string>): SeatOutcome {
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return { seat: seat.id, title: seat.title, status: 'discarded', review: null, reason: 'AI_OUTPUT_INVALID: the review did not match the required shape.' };
  const cited = new Set<string>([...parsed.data.citedIds, ...parsed.data.concerns.flatMap((c) => c.evidenceIds)]);
  for (const id of cited) {
    if (!allowedIds.has(id)) return { seat: seat.id, title: seat.title, status: 'discarded', review: null, reason: `AI_OUTPUT_UNSUPPORTED_EVIDENCE: cited "${id.slice(0, 60)}", which is not in the evidence snapshot.` };
  }
  if (allowedIds.size === 0 && parsed.data.verdict !== 'INSUFFICIENT_EVIDENCE') return { seat: seat.id, title: seat.title, status: 'discarded', review: null, reason: 'AI_OUTPUT_UNGROUNDED: a verdict other than INSUFFICIENT_EVIDENCE was given with no evidence in the snapshot.' };
  return { seat: seat.id, title: seat.title, status: 'reviewed', review: parsed.data, reason: null };
}

const VERDICT_RANK: Record<Verdict, number> = { REJECT: 0, INSUFFICIENT_EVIDENCE: 1, CONDITIONAL: 2, APPROVE: 3 };

/**
 * Deterministic floor for the overall verdict: the least favourable accepted
 * reviewer verdict. The chair may not exceed it unless it records a
 * disagreement explaining why; if the chair's output violates that rule or
 * fails validation, the floor stands and the chair is reported as absent.
 */
export function floorVerdict(seats: SeatOutcome[]): Verdict {
  const accepted = seats.filter((s) => s.status === 'reviewed' && s.review).map((s) => s.review!.verdict);
  if (accepted.length === 0) return 'INSUFFICIENT_EVIDENCE';
  return accepted.reduce((worst, v) => (VERDICT_RANK[v] < VERDICT_RANK[worst] ? v : worst), accepted[0]);
}

export function acceptChair(raw: unknown, seats: SeatOutcome[], allowedIds: ReadonlySet<string>): { chair: ChairSynthesis | null; verdict: Verdict; reason: string | null } {
  const floor = floorVerdict(seats);
  const parsed = chairSchema.safeParse(raw);
  if (!parsed.success) return { chair: null, verdict: floor, reason: 'AI_OUTPUT_INVALID: the chair synthesis did not match the required shape.' };
  for (const id of parsed.data.citedIds) if (!allowedIds.has(id)) return { chair: null, verdict: floor, reason: `AI_OUTPUT_UNSUPPORTED_EVIDENCE: the chair cited "${id.slice(0, 60)}", which is not in the evidence snapshot.` };
  if (VERDICT_RANK[parsed.data.verdict] > VERDICT_RANK[floor] && parsed.data.disagreements.length === 0) {
    return { chair: { ...parsed.data, verdict: floor }, verdict: floor, reason: `CHAIR_OVERRULED: the chair returned ${parsed.data.verdict} above the reviewers' floor of ${floor} without recording a disagreement; the floor stands.` };
  }
  return { chair: parsed.data, verdict: parsed.data.verdict, reason: null };
}
