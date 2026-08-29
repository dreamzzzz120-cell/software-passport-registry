/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import LegalPageLayout from './LegalPageLayout';

// Legal-document scaffolding for production review, not a claim of legal
// certification. Bracketed placeholders mark facts this repository does not
// itself contain (legal entity name, jurisdiction, contact address) and must
// be filled in by counsel before this page is relied upon commercially.
// Every description of what SPR does is deliberately scoped to what the
// product actually does today: it aggregates and analyzes evidence and
// presents trust signals, it does not certify, guarantee, or provide legal,
// financial, cybersecurity, compliance, or other professional advice.
export default function TermsView() {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated="[DATE — LEGAL REVIEW REQUIRED]">
      <p>
        These Terms of Service ("Terms") govern access to and use of Software Passport Registry (the "Service"), operated by
        <strong> [LEGAL ENTITY NAME]</strong> ("SPR", "we", "us", or "our"). This document is scaffolding prepared for legal
        review prior to commercial launch and does not itself constitute a certified or finalized legal agreement.
      </p>

      <section>
        <h2>1. Acceptance of Terms</h2>
        <p>
          By creating an account, accessing, or using the Service, you agree to be bound by these Terms. If you are using the
          Service on behalf of an organization (for example, as a managed service provider or an enterprise customer), you
          represent that you have authority to bind that organization, and "you" refers to both you and that organization.
        </p>
      </section>

      <section>
        <h2>2. Description of the Service</h2>
        <p>
          SPR is a software evidence-and-trust platform. It helps you inventory software, collect and organize evidence about
          that software (such as software bills of materials, vulnerability scan results, repository integrity signals, and
          provenance attestations), and present that evidence as trust scores, reports, and dashboards.
        </p>
        <p>
          <strong>The Service reports on evidence — it does not certify, warrant, guarantee, or attest that any software,
          vendor, or organization is secure, compliant, or free of vulnerabilities.</strong> Where evidence is missing or has
          not been independently verified, the Service is designed to say so explicitly rather than presenting an assumed or
          estimated result as a confirmed one. A trust score or "Verified" label reflects the evidence available to SPR at the
          time it was computed, not an independent audit, certification, or legal opinion.
        </p>
      </section>

      <section>
        <h2>3. Accounts and Customer Responsibilities</h2>
        <ul>
          <li>You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account.</li>
          <li>You must provide accurate registration information and keep it up to date.</li>
          <li>If you manage other users under your workspace (for example, inviting team members or clients), you are responsible for the roles and access you grant them.</li>
          <li>You are responsible for the accuracy of any software inventory, evidence, or attestation data you submit to the Service.</li>
        </ul>
      </section>

      <section>
        <h2>4. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service to submit evidence you know to be false, fabricated, or materially misleading (including a self-declared "Verified" status not supported by the underlying evidence).</li>
          <li>Attempt to access another tenant's, client's, or user's data without authorization.</li>
          <li>Probe, scan, or test the Service's security controls without our prior written authorization.</li>
          <li>Use the Service to violate any applicable law, or the intellectual property or privacy rights of any third party.</li>
          <li>Interfere with or disrupt the integrity or performance of the Service, including through excessive automated requests.</li>
        </ul>
      </section>

      <section>
        <h2>5. Evidence and Data Submitted by Users</h2>
        <p>
          You retain ownership of the software inventory, evidence, attestations, and other content you submit to the Service
          ("Customer Data"). You grant SPR a license to host, process, analyze, and display Customer Data solely to provide
          and improve the Service for you. SPR independently re-verifies certain categories of self-reported evidence (for
          example, hash-integrity and structural checks on submitted attestations) before presenting a corresponding
          "Verified" status — see the Service's evidence documentation for the specific checks performed for each evidence
          type. Independent re-verification does not extend to guarantees the Service does not itself perform, such as full
          cryptographic signature-chain verification against a third-party transparency log, unless the Service's own
          documentation for that feature states otherwise.
        </p>
      </section>

      <section>
        <h2>6. Intellectual Property</h2>
        <p>
          SPR and its licensors retain all right, title, and interest in and to the Service, including its software, design,
          and underlying technology, excluding Customer Data. Subject to these Terms, SPR grants you a limited,
          non-exclusive, non-transferable license to access and use the Service for your internal business purposes during
          your subscription term.
        </p>
      </section>

      <section>
        <h2>7. Third-Party Services and Data Sources</h2>
        <p>
          The Service integrates with, and may retrieve or send data to, third-party services you choose to connect
          (for example, source-code hosting providers, security-scanning tools, and MSP operations platforms), as well as
          infrastructure and processing providers SPR uses to operate the Service (for example, authentication, payment
          processing, hosting, and optional AI-assisted summarization or error-monitoring providers). Use of any third-party
          service is also subject to that provider's own terms. SPR is not responsible for the accuracy, availability, or
          practices of third-party services or data sources.
        </p>
      </section>

      <section>
        <h2>8. Availability and Service Changes</h2>
        <p>
          We aim to keep the Service available and reliable, but we do not guarantee uninterrupted or error-free operation.
          We may modify, suspend, or discontinue features of the Service, and we will make reasonable efforts to notify
          customers of material changes that affect them.
        </p>
      </section>

      <section>
        <h2>9. Disclaimers</h2>
        <p>
          <strong>
            THE SERVICE, INCLUDING ALL TRUST SCORES, EVIDENCE SUMMARIES, REPORTS, AND OTHER OUTPUT, IS PROVIDED FOR
            INFORMATIONAL AND DUE-DILIGENCE PURPOSES ONLY. IT IS NOT LEGAL, FINANCIAL, CYBERSECURITY, COMPLIANCE, OR OTHER
            PROFESSIONAL ADVICE, AND IT IS NOT A SUBSTITUTE FOR INDEPENDENT PROFESSIONAL JUDGMENT, AN INDEPENDENT SECURITY
            AUDIT, OR A FORMAL CERTIFICATION.
          </strong>{' '}
          SPR does not represent that the Service, or any software assessed using the Service, is secure, compliant with any
          particular law or standard, or free of vulnerabilities. Except as expressly stated in a separately negotiated
          written agreement, the Service is provided "as is" and "as available," without warranties of any kind, whether
          express, implied, or statutory, including implied warranties of merchantability, fitness for a particular purpose,
          and non-infringement.
        </p>
      </section>

      <section>
        <h2>10. Limitation of Liability</h2>
        <p>
          [LIMITATION OF LIABILITY LANGUAGE — LEGAL REVIEW REQUIRED.] To the maximum extent permitted by applicable law, SPR
          and its officers, employees, and agents will not be liable for any indirect, incidental, special, consequential, or
          punitive damages, or for any loss of profits, revenue, data, or business opportunity, arising out of or related to
          your use of the Service, even if advised of the possibility of such damages. SPR's total aggregate liability
          arising out of or related to these Terms or the Service will not exceed the amount you paid SPR for the Service in
          the twelve (12) months preceding the event giving rise to the claim.
        </p>
      </section>

      <section>
        <h2>11. Indemnification</h2>
        <p>
          You agree to indemnify and hold SPR harmless from any claims, damages, liabilities, and expenses (including
          reasonable legal fees) arising from your use of the Service in violation of these Terms, your Customer Data, or
          your violation of any applicable law or third-party right.
        </p>
      </section>

      <section>
        <h2>12. Termination</h2>
        <p>
          You may stop using the Service and close your account at any time. We may suspend or terminate your access to the
          Service if you materially breach these Terms, or as required to comply with applicable law. Upon termination, your
          right to use the Service ends; provisions of these Terms that by their nature should survive termination
          (including intellectual property, disclaimers, limitation of liability, and indemnification) will survive.
        </p>
      </section>

      <section>
        <h2>13. Governing Law</h2>
        <p>
          [JURISDICTION AND GOVERNING LAW — LEGAL REVIEW REQUIRED. This section intentionally does not assert a jurisdiction
          until confirmed by counsel.]
        </p>
      </section>

      <section>
        <h2>14. Privacy</h2>
        <p>
          Our collection and use of personal information in connection with the Service is described in our{' '}
          <a href="/privacy">Privacy Policy</a>, which is incorporated into these Terms by reference.
        </p>
      </section>

      <section>
        <h2>15. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. If we make material changes, we will provide reasonable notice (for
          example, by posting an updated version with a new "Last updated" date, or by direct notice to account
          administrators). Continued use of the Service after changes take effect constitutes acceptance of the revised
          Terms.
        </p>
      </section>

      <section>
        <h2>16. Contact</h2>
        <p>
          Questions about these Terms can be directed to <strong>[LEGAL CONTACT EMAIL]</strong>.
        </p>
      </section>
    </LegalPageLayout>
  );
}
