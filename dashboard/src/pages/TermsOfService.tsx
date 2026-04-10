export function TermsOfService({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', color: 'var(--fg)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '3rem 2rem' }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', marginBottom: '2rem', padding: 0 }}
        >
          ← Back
        </button>

        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.5rem' }}>Terms of Service</h1>
        <p style={{ color: 'var(--dim)', fontSize: '0.85rem', marginBottom: '2.5rem' }}>
          Last updated: April 10, 2026
        </p>

        <Section title="1. Acceptance of Terms">
          By accessing or using the EFFANT API and associated services ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree, do not use the Service. These Terms apply to all users, including individuals and organizations.
        </Section>

        <Section title="2. Description of Service">
          EFFANT provides a REST API for accessing indexed Solana blockchain data, including wallet profiling, anomaly detection, entity clustering, and transaction analytics. The Service is accessed via api.effant.tech and managed via effant.tech.
        </Section>

        <Section title="3. Account Registration">
          You must provide a valid email address and create a password to use the Service. You are responsible for maintaining the confidentiality of your API key and account credentials. You must notify us immediately at billing@effant.tech if you suspect unauthorized use of your account. You must be at least 18 years old to create an account.
        </Section>

        <Section title="4. Subscriptions and Payment">
          <b>Billing:</b> Subscriptions are billed monthly via Stripe. By subscribing, you authorize recurring charges to your payment method.<br /><br />
          <b>Pricing:</b> Current pricing is listed at effant.tech. We reserve the right to change pricing with 30 days' notice.<br /><br />
          <b>Cancellation:</b> You may cancel at any time. Cancellation takes effect at the end of the current billing period. No refunds are issued for partial months.<br /><br />
          <b>Failed payments:</b> If payment fails, we may suspend your API access until payment is resolved.
        </Section>

        <Section title="5. Acceptable Use">
          You agree not to:<br /><br />
          • Use the Service for any unlawful purpose or in violation of any applicable law<br />
          • Resell or redistribute raw API responses as a competing data product without written consent<br />
          • Attempt to reverse-engineer, scrape, or extract the underlying database<br />
          • Exceed your rate limits or attempt to circumvent them<br />
          • Use the Service to facilitate market manipulation, fraud, or money laundering<br />
          • Interfere with or disrupt the Service or its infrastructure
        </Section>

        <Section title="6. API Usage and Rate Limits">
          Your subscription tier determines your daily API call limit (Starter: 10,000/day; Pro: 500,000/day). Limits reset at midnight UTC. Exceeding your limit will result in a 429 response. We do not credit calls lost due to downtime unless uptime falls below 99% in a calendar month.
        </Section>

        <Section title="7. Intellectual Property">
          The Service, including its software, algorithms, and documentation, is owned by EFFANT and protected by intellectual property laws. On-chain blockchain data is publicly available and not owned by EFFANT. You retain ownership of any applications or products you build using our API output.
        </Section>

        <Section title="8. Data and Privacy">
          Our collection and use of your personal data is governed by our Privacy Policy at effant.tech. By using the Service, you consent to the practices described there.
        </Section>

        <Section title="9. Availability and SLA">
          We target 99.9% API uptime, measured monthly, excluding scheduled maintenance. We will provide advance notice of scheduled maintenance where possible. The Service is provided on an "as is" basis. We do not guarantee that the Service will be uninterrupted or error-free.
        </Section>

        <Section title="10. Disclaimer of Warranties">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WE DO NOT WARRANT THE ACCURACY OR COMPLETENESS OF ANY BLOCKCHAIN DATA PROVIDED.
        </Section>

        <Section title="11. Limitation of Liability">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, EFFANT SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS OR DATA, ARISING OUT OF YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM SHALL NOT EXCEED THE AMOUNT YOU PAID US IN THE THREE MONTHS PRECEDING THE CLAIM.
        </Section>

        <Section title="12. Indemnification">
          You agree to indemnify and hold harmless EFFANT and its officers, directors, and employees from any claims, damages, or expenses (including legal fees) arising from your use of the Service, your violation of these Terms, or your violation of any third-party rights.
        </Section>

        <Section title="13. Termination">
          We may suspend or terminate your account at any time for violation of these Terms, fraudulent activity, or any reason at our sole discretion with or without notice. Upon termination, your right to access the Service immediately ceases. Sections 7, 10, 11, and 12 survive termination.
        </Section>

        <Section title="14. Changes to Terms">
          We may update these Terms at any time. We will notify you by email if changes are material. Continued use of the Service after changes constitutes acceptance of the revised Terms.
        </Section>

        <Section title="15. Governing Law">
          These Terms are governed by the laws of the State of Delaware, United States, without regard to conflict of law principles. Any disputes shall be resolved in the courts of Delaware.
        </Section>

        <Section title="16. Contact">
          Questions about these Terms? Email us at billing@effant.tech.
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--accent)' }}>{title}</h2>
      <p style={{ fontSize: '0.9rem', lineHeight: 1.7, color: 'var(--fg)', opacity: 0.85 }}>{children}</p>
    </div>
  )
}
