/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Data Processing Agreement, as data. The public /dpa page renders it,
 * the signed PDF embeds it, and the server hashes its canonical text so an
 * execution record is bound to the exact wording that was accepted. Change
 * the wording and DPA_VERSION together: an execution of an older version
 * stays valid for that version and is reported as such.
 */

import { SUBPROCESSORS } from './subprocessors.ts';

export const DPA_VERSION = '2026-09-13.1';
export const DPA_EFFECTIVE_DATE = 'September 13, 2026';

export interface DpaSection { heading: string; paragraphs: string[]; bullets?: string[] }

export const DPA_PREAMBLE: string[] = [
  'This Data Processing Agreement ("DPA") forms part of the agreement between the customer identified in the execution record ("Customer") and Software Passport Registry Ltd., a company incorporated in British Columbia, Canada ("SPR"), for the Software Passport Registry service (the "Service"), and reflects the parties’ agreement with regard to the processing of Personal Data by SPR on behalf of Customer.',
  'This DPA applies to the extent that SPR processes Personal Data subject to Data Protection Law on behalf of Customer in the course of providing the Service. In the event of a conflict between this DPA and the Terms of Service, this DPA prevails with respect to the processing of Personal Data.',
];

export const DPA_SECTIONS: DpaSection[] = [
  {
    heading: '1. Definitions',
    paragraphs: [
      '"Data Protection Law" means all laws applicable to the processing of Personal Data under this DPA, including, where applicable, the EU General Data Protection Regulation 2016/679 ("GDPR"), the UK GDPR and Data Protection Act 2018, the Swiss Federal Act on Data Protection, Canada’s Personal Information Protection and Electronic Documents Act ("PIPEDA") and the British Columbia Personal Information Protection Act, and applicable US state privacy laws.',
      '"Personal Data" means any information relating to an identified or identifiable natural person that SPR processes on behalf of Customer in connection with the Service.',
      '"Controller", "Processor", "Data Subject", "Processing", "Personal Data Breach" and "Supervisory Authority" have the meanings given in Data Protection Law. Where PIPEDA applies, "Controller" is read as the organisation accountable for the Personal Data and "Processor" as the organisation processing it on that organisation’s behalf.',
      '"Subprocessor" means a third party engaged by SPR to process Personal Data on behalf of Customer.',
      '"Customer Data" means data submitted to the Service by or on behalf of Customer, including Personal Data.',
    ],
  },
  {
    heading: '2. Roles and scope',
    paragraphs: [
      'Customer is the Controller (or, where Customer acts on behalf of its own clients, a Processor acting under its clients’ instructions) and SPR is the Processor of Personal Data processed through the Service. Where Customer is an MSP acting for its clients, Customer warrants that it has the authority to instruct SPR on their behalf.',
      'The subject matter, duration, nature and purpose of the processing, the types of Personal Data and the categories of Data Subjects are described in Annex 1.',
    ],
  },
  {
    heading: '3. Customer instructions',
    paragraphs: [
      'SPR shall process Personal Data only on documented instructions from Customer, including with regard to transfers of Personal Data to a third country, unless required to do so by law to which SPR is subject; in such a case SPR shall inform Customer of that legal requirement before processing unless the law prohibits such information on important grounds of public interest.',
      'The Terms of Service, this DPA and Customer’s use of the Service’s features (including which repositories, integrations and evidence Customer chooses to submit) constitute Customer’s complete and final instructions. SPR shall promptly inform Customer if, in SPR’s opinion, an instruction infringes Data Protection Law.',
    ],
  },
  {
    heading: '4. Confidentiality',
    paragraphs: [
      'SPR shall ensure that persons authorised to process Personal Data have committed themselves to confidentiality or are under an appropriate statutory obligation of confidentiality, and that access to Personal Data is limited to those personnel who require it to perform the Service.',
    ],
  },
  {
    heading: '5. Security',
    paragraphs: [
      'Taking into account the state of the art, the costs of implementation and the nature, scope, context and purposes of processing, as well as the risk of varying likelihood and severity for the rights and freedoms of natural persons, SPR shall implement appropriate technical and organisational measures to ensure a level of security appropriate to the risk. The measures in force are described in Annex 2.',
      'Annex 2 describes controls that are implemented in the Service as operated at the date of this DPA. SPR does not represent that the Service holds any third-party security certification unless a specific certification is separately documented and current.',
    ],
  },
  {
    heading: '6. Subprocessors',
    paragraphs: [
      'Customer provides general authorisation for SPR to engage the Subprocessors listed in Annex 3, and to replace or add Subprocessors subject to this clause. SPR shall impose data protection obligations on each Subprocessor that are no less protective than those in this DPA, and remains liable to Customer for the performance of each Subprocessor’s obligations.',
      'SPR shall publish its current Subprocessor list at https://www.softwarepassportregistry.com/subprocessors/ and shall give Customer at least thirty (30) days’ notice of any intended addition or replacement of a Subprocessor, by updating that page and, where Customer has an active workspace, by notice to the workspace Owner’s email address. Customer may object on reasonable data-protection grounds within that period; if the parties cannot resolve the objection in good faith, Customer may terminate the affected Service and receive a pro-rata refund of prepaid fees for the remaining term.',
    ],
  },
  {
    heading: '7. Data Subject rights',
    paragraphs: [
      'Taking into account the nature of the processing, SPR shall assist Customer by appropriate technical and organisational measures, insofar as this is possible, for the fulfilment of Customer’s obligation to respond to requests for exercising Data Subject rights. The Service allows workspace Owners and Admins to view, correct, export and delete Personal Data directly; where a request cannot be fulfilled through the Service, SPR shall assist within a reasonable time on written request.',
      'If SPR receives a request from a Data Subject relating to Customer’s Personal Data, SPR shall, to the extent legally permitted, promptly refer the Data Subject to Customer and shall not respond except on Customer’s documented instructions or as required by law.',
    ],
  },
  {
    heading: '8. Personal Data Breach',
    paragraphs: [
      'SPR shall notify Customer without undue delay, and in any event within seventy-two (72) hours, after becoming aware of a Personal Data Breach affecting Customer’s Personal Data. The notification shall describe, to the extent known, the nature of the breach, the categories and approximate number of Data Subjects and records concerned, the likely consequences, and the measures taken or proposed to address the breach and mitigate its effects. SPR may provide information in phases as it becomes available.',
    ],
  },
  {
    heading: '9. Assistance with assessments and consultations',
    paragraphs: [
      'Taking into account the nature of the processing and the information available to SPR, SPR shall provide reasonable assistance to Customer in ensuring compliance with Customer’s obligations regarding security of processing, notification of Personal Data Breaches, data protection impact assessments and prior consultation with Supervisory Authorities.',
    ],
  },
  {
    heading: '10. Deletion and return',
    paragraphs: [
      'On termination of the Service, or earlier at Customer’s request, SPR shall delete all Personal Data processed on behalf of Customer, unless applicable law requires storage of the Personal Data. The Service provides an Owner-initiated Tenant Offboarding function that deletes all tenant-scoped records in a single database transaction and removes the tenant’s user accounts from the identity provider. Customer may export its data through the Service before initiating offboarding.',
      'Backups held by SPR’s hosting provider are overwritten in the ordinary course of the provider’s backup rotation; deleted Personal Data is not restored from backup except where required to recover from a service failure, in which case the deletion is re-applied.',
    ],
  },
  {
    heading: '11. Audit and information',
    paragraphs: [
      'SPR shall make available to Customer all information necessary to demonstrate compliance with the obligations laid down in this DPA and shall allow for and contribute to audits, including inspections, conducted by Customer or an independent auditor mandated by Customer, no more than once in any twelve (12) month period unless a Personal Data Breach has occurred or a Supervisory Authority requires otherwise. Audits shall be conducted on reasonable written notice, during business hours, subject to reasonable confidentiality obligations, and without unreasonable disruption to SPR’s operations. SPR may first satisfy an audit request by providing documentation, the Service’s tamper-evident audit trail export, and written responses to reasonable questions.',
    ],
  },
  {
    heading: '12. International transfers',
    paragraphs: [
      'Customer acknowledges that SPR and its Subprocessors process Personal Data in Canada and the United States, as described in Annex 3. Canada is the subject of an adequacy decision by the European Commission for commercial organisations subject to PIPEDA. To the extent Personal Data subject to the GDPR or UK GDPR is transferred to a country without an adequacy decision, the parties agree that the European Commission’s Standard Contractual Clauses (Decision (EU) 2021/914, Module Two (controller to processor) or Module Three (processor to processor) as applicable) and, for UK transfers, the UK International Data Transfer Addendum, are incorporated by reference, with Customer as data exporter and SPR as data importer, and with the information required by their annexes taken from Annexes 1 to 3 of this DPA.',
    ],
  },
  {
    heading: '13. Liability',
    paragraphs: [
      'Each party’s liability arising out of or related to this DPA is subject to the exclusions and limitations of liability set out in the Terms of Service or the separate written agreement between the parties, and any reference to the liability of a party means the aggregate liability of that party under the Terms of Service and this DPA together.',
    ],
  },
  {
    heading: '14. Term and precedence',
    paragraphs: [
      'This DPA takes effect on the date recorded in the execution record and remains in force for as long as SPR processes Personal Data on behalf of Customer. This DPA may be executed electronically through the Service by a workspace Owner; the execution record, including its cryptographic signature, is evidence of the version accepted, the signatory and the time of acceptance.',
      'This DPA is governed by the laws of the Province of British Columbia and the federal laws of Canada applicable therein, except that the Standard Contractual Clauses, where they apply, are governed as stated in those clauses.',
    ],
  },
];

export const DPA_ANNEX_1: DpaSection[] = [
  {
    heading: 'Annex 1 — Details of processing',
    paragraphs: [],
    bullets: [
      'Subject matter: provision of the Software Passport Registry service, which inventories software assets, collects and verifies evidence about them, and produces trust records, findings, reports and alerts.',
      'Duration: the term of Customer’s use of the Service, plus the deletion period described in section 10.',
      'Nature and purpose: hosting, storage, scanning, analysis and display of Customer Data to provide the Service; sending transactional email; billing; error monitoring; and, where Customer enables it, AI-assisted explanation of evidence that Customer has already submitted.',
      'Categories of Data Subjects: Customer’s workspace users (employees and contractors); Customer’s clients’ contacts where Customer records them; software authors, maintainers and committers whose identifiers appear in scanned repositories; contacts recorded in privacy and vendor records Customer maintains in the Service.',
      'Types of Personal Data: names, business email addresses, job titles, company names, IP addresses and user-agent strings in access logs and the audit trail, sign-in metadata, identifiers appearing in repository metadata (commit authors, usernames), and any Personal Data Customer chooses to include in evidence, attestations, questionnaires, privacy inventories or notes.',
      'Special categories of data: none are required by the Service and Customer agrees not to submit them.',
    ],
  },
];

export const DPA_ANNEX_2: DpaSection[] = [
  {
    heading: 'Annex 2 — Technical and organisational measures',
    paragraphs: ['The following measures are implemented in the Service as operated at the date of this DPA.'],
    bullets: [
      'Tenant isolation: every tenant-scoped table is protected by PostgreSQL row-level security; the application connects with a least-privilege runtime role and sets the tenant context per request, so a query cannot read another tenant’s rows.',
      'Authentication: Firebase Authentication with server-side ID-token verification and revocation checking on every API request; email verification required before workspace access; optional multi-factor authentication.',
      'Authorisation: role-based access (Owner, Admin, Technician, Viewer, Client) enforced on the server for every route; Client-role users are scoped to a single client record.',
      'Encryption in transit: HTTPS/TLS on every public endpoint with HTTP Strict Transport Security; TLS to the database and to every third-party API.',
      'Encryption at rest: integration credentials are encrypted with a dedicated key before storage; the hosting provider encrypts database volumes at rest.',
      'Integrity: an append-only, hash-chained audit trail records security-relevant actions; evidence records carry content hashes and timestamps.',
      'Abuse controls: rate limiting on every API route backed by a shared store; request-body size limits; input validation on every write.',
      'Browser hardening: Content Security Policy, frame denial, MIME-sniffing protection, referrer and permissions policies on every response.',
      'Operations: dependency vulnerability scanning in continuous integration; error monitoring; deployment health checks that fail closed if tenant isolation cannot be asserted.',
      'Data deletion: Owner-initiated tenant offboarding deletes all tenant-scoped records atomically and removes the tenant’s identity-provider accounts; per-tenant retention policies purge notification and billing-audit records on schedule.',
    ],
  },
];

export function dpaAnnex3(): DpaSection {
  return {
    heading: 'Annex 3 — Subprocessors',
    paragraphs: ['The current list is maintained at https://www.softwarepassportregistry.com/subprocessors/. Providers marked "when configured" are engaged only if the corresponding credential is present on the deployment.'],
    bullets: SUBPROCESSORS.map((s) => `${s.legalEntity} (${s.name}) — ${s.purpose} Location: ${s.location}${s.optional ? ' (when configured)' : ''}`),
  };
}

export function dpaAllSections(): DpaSection[] {
  return [...DPA_SECTIONS, ...DPA_ANNEX_1, ...DPA_ANNEX_2, dpaAnnex3()];
}

/**
 * Canonical text of the whole document. Deterministic, so its SHA-256 is a
 * stable identifier for this exact wording. Rendering may differ; the hash
 * is over this string only.
 */
export function dpaCanonicalText(): string {
  const parts: string[] = [`SPR DATA PROCESSING AGREEMENT ${DPA_VERSION}`, ...DPA_PREAMBLE];
  for (const section of dpaAllSections()) {
    parts.push(section.heading, ...section.paragraphs, ...(section.bullets ?? []).map((b) => `- ${b}`));
  }
  return parts.join('\n');
}
