/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import LegalPageLayout from './LegalPageLayout';

// Legal-document scaffolding for production review. Every factual claim
// below (what is collected, which third parties are involved, whether
// cookies are used) is scoped to what this codebase actually does, not an
// aspirational or templated description -- see the production-readiness
// audit this page was written in response to. Bracketed placeholders mark
// facts the repository does not itself contain and that require legal/
// operational sign-off before this page is relied upon commercially.
export default function PrivacyPolicyView() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="[DATE — LEGAL REVIEW REQUIRED]">
      <p>
        This Privacy Policy describes how <strong>[LEGAL ENTITY NAME]</strong> ("SPR", "we", "us", or "our") handles
        information in connection with Software Passport Registry (the "Service"). This document is scaffolding prepared
        for legal review and does not itself assert compliance with any specific privacy law unless stated otherwise below.
      </p>

      <section>
        <h2>1. Information We Collect</h2>
        <p><strong>Account information.</strong> When you or your organization create an account, we collect information such as name, email address, company name, and role.</p>
        <p><strong>Software, repository, and evidence information.</strong> The Service is designed around software inventory and evidence: information you or your organization submits about software assets, clients, software bills of materials, vulnerability scan results, repository metadata, and provenance/attestation statements. Where you connect a third-party source (for example, a source-code repository or an MSP operations platform), we collect the data that integration provides in order to generate evidence and trust scores.</p>
        <p><strong>Technical and log information.</strong> We automatically collect certain technical information needed to operate and secure the Service, including IP address, browser/user-agent information, request timestamps, and records of actions taken in your workspace (an audit trail).</p>
      </section>

      <section>
        <h2>2. Cookies and Local Storage</h2>
        <p>
          The Service does not set third-party advertising or tracking cookies. Your signed-in session is managed by our
          authentication provider (Firebase Authentication). The Service uses browser local storage for a small number of
          interface preferences on your own device — for example, remembering that you have dismissed a guided product tour
          — which is not transmitted to SPR's servers and does not identify you across other websites.
        </p>
      </section>

      <section>
        <h2>3. How We Use Information</h2>
        <ul>
          <li>To provide, maintain, and secure the Service, including generating evidence-based trust scores and reports.</li>
          <li>To authenticate users and enforce access controls and tenant/client data isolation.</li>
          <li>To process billing and manage subscriptions.</li>
          <li>To detect, investigate, and prevent misuse, security incidents, or violations of our Terms of Service.</li>
          <li>To communicate with you about your account or the Service.</li>
        </ul>
      </section>

      <section>
        <h2>4. Third-Party Service Providers</h2>
        <p>We use the following categories of third-party providers to operate the Service. We do not sell personal information to any of them.</p>
        <ul>
          <li><strong>Authentication:</strong> Firebase Authentication (Google), to manage sign-in and session security.</li>
          <li><strong>Billing:</strong> Stripe, to process subscription payments. SPR does not itself store full payment card numbers.</li>
          <li><strong>Hosting and infrastructure:</strong> our application backend and database are hosted on Railway; our web frontend is delivered via Vercel.</li>
          <li><strong>Optional AI-assisted summarization:</strong> where enabled for your workspace, certain content may be sent to Google's Gemini API to generate a plain-language summary. This is an assistive text generation feature, not an evidentiary or scoring source.</li>
          <li><strong>Optional error monitoring:</strong> where configured, we use Sentry to capture application error reports to help us fix defects.</li>
          <li><strong>Integrations you choose to connect:</strong> source-code hosting providers (for example, GitHub, GitLab, Bitbucket, Azure DevOps) and MSP operations platforms (for example, ConnectWise, Autotask, NinjaOne, Hudu). These connections are opt-in and configured per workspace; we only access the data those integrations are authorized to provide.</li>
        </ul>
      </section>

      <section>
        <h2>5. Data Retention</h2>
        <p>
          We retain account and workspace data for as long as your account or workspace remains active, and for a limited
          period afterward as needed for legitimate business, security, or legal purposes. If you request deletion of your
          account or workspace, we will remove the associated data from our primary systems. [A formal data-retention
          schedule, and the complete scope of deletion across every processor listed above, is pending legal/operational
          review and will be documented here.]
        </p>
      </section>

      <section>
        <h2>6. Security Measures</h2>
        <p>
          We use encryption in transit (HTTPS/TLS), tenant- and client-level data isolation, encrypted storage of
          third-party integration credentials, audit logging of material account and data actions, and rate limiting on
          sensitive endpoints. No security measure is perfect, and we cannot guarantee absolute security of any information
          you transmit to the Service.
        </p>
      </section>

      <section>
        <h2>7. Data Sharing</h2>
        <p>
          We do not sell your personal information. We share information only: with the third-party service providers
          described above, each acting on our behalf; with other members of your own organization's workspace, according to
          the roles and permissions configured for that workspace; when required by law, legal process, or to protect the
          rights, property, or safety of SPR, our users, or others; or in connection with a merger, acquisition, or sale of
          assets, subject to continued protection of personal information under this Policy or its successor.
        </p>
      </section>

      <section>
        <h2>8. Your Rights and How to Contact Us</h2>
        <p>
          Depending on where you are located, you may have rights to access, correct, or delete personal information we
          hold about you, or to object to certain processing. To make a request, contact us at{' '}
          <strong>[LEGAL CONTACT EMAIL]</strong>. [The specific legal rights and response timelines applicable to you depend
          on your jurisdiction and are pending legal review; this Policy does not itself assert compliance with any
          specific privacy law, such as GDPR or CCPA, unless and until that compliance work is completed and confirmed.]
        </p>
      </section>

      <section>
        <h2>9. International Data Handling</h2>
        <p>
          Our hosting and service providers may process information in countries other than your own. [Cross-border
          transfer mechanisms and specific data-residency commitments are pending legal review and will be documented
          here.]
        </p>
      </section>

      <section>
        <h2>10. Children's Privacy</h2>
        <p>
          The Service is intended for business use and is not directed to children. We do not knowingly collect personal
          information from children under the age of 16. If you believe a child has provided us with personal information,
          please contact us so we can address it.
        </p>
      </section>

      <section>
        <h2>11. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. If we make material changes, we will update the "Last
          updated" date above and, where appropriate, provide additional notice.
        </p>
      </section>

      <section>
        <h2>12. Contact</h2>
        <p>
          Questions about this Privacy Policy can be directed to <strong>[LEGAL CONTACT EMAIL]</strong>.
        </p>
      </section>
    </LegalPageLayout>
  );
}
