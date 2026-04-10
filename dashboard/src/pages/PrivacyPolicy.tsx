export function PrivacyPolicy({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', color: 'var(--fg)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '3rem 2rem' }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', marginBottom: '2rem', padding: 0 }}
        >
          ← Back
        </button>

        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.5rem' }}>Privacy Policy</h1>
        <p style={{ color: 'var(--dim)', fontSize: '0.85rem', marginBottom: '2.5rem' }}>
          Last updated: April 10, 2026
        </p>

        <Section title="1. Who We Are">
          EFFANT ("we", "us", "our") operates the Solana Intelligence Platform at effant.tech and api.effant.tech. We provide on-chain Solana data analytics via a REST API. Our contact email is billing@effant.tech.
        </Section>

        <Section title="2. What Data We Collect">
          <b>Account data:</b> When you sign up, we collect your email address and a hashed password. We do not store plaintext passwords.<br /><br />
          <b>Payment data:</b> Payments are processed by Stripe. We do not store credit card numbers. We receive and store your Stripe customer ID and subscription status.<br /><br />
          <b>Usage data:</b> We log API calls including the endpoint, HTTP method, response time, and status code associated with your API key. We do not log request or response bodies.<br /><br />
          <b>Blockchain data:</b> We index publicly available Solana on-chain data (wallet addresses, transaction signatures, amounts, timestamps). This data is public by nature of the blockchain and contains no personally identifiable information.
        </Section>

        <Section title="3. How We Use Your Data">
          We use your data to:<br /><br />
          • Provide and operate the EFFANT API service<br />
          • Process payments and manage your subscription<br />
          • Send transactional emails (receipts, API key delivery, password resets)<br />
          • Send a daily digest email if you opt in<br />
          • Monitor API usage for rate limiting and abuse prevention<br />
          • Improve our service through aggregated, anonymized analytics
        </Section>

        <Section title="4. Data Sharing">
          We do not sell, rent, or trade your personal data. We share data only with:<br /><br />
          • <b>Stripe</b> — payment processing (stripe.com/privacy)<br />
          • <b>SendGrid</b> — transactional email delivery<br />
          • <b>Railway</b> — cloud infrastructure hosting<br />
          • <b>Sentry</b> — error monitoring (error logs only, no PII)<br /><br />
          We may disclose data if required by law or to protect our legal rights.
        </Section>

        <Section title="5. Data Retention">
          • Account and subscription data: retained while your account is active and for 90 days after deletion<br />
          • API call logs: retained for 90 days<br />
          • Blockchain transaction data: retained for 30 days on a rolling basis<br />
          • Payment records: retained as required by applicable law (typically 7 years)
        </Section>

        <Section title="6. Your Rights">
          You may at any time:<br /><br />
          • <b>Access</b> your account data by logging into the portal<br />
          • <b>Correct</b> your email by contacting billing@effant.tech<br />
          • <b>Delete</b> your account by emailing billing@effant.tech — we will delete your account and associated data within 30 days<br />
          • <b>Export</b> your API call history by contacting us<br /><br />
          If you are in the EU or UK, you have rights under GDPR including the right to lodge a complaint with your local data protection authority.
        </Section>

        <Section title="7. Cookies">
          We do not use tracking cookies. We use localStorage in your browser solely to store your authentication token. No third-party advertising or analytics cookies are set.
        </Section>

        <Section title="8. Security">
          We use HTTPS for all data in transit. Passwords are hashed using bcrypt. API keys are stored as SHA-256 hashes. We use industry-standard security practices, but no system is completely secure.
        </Section>

        <Section title="9. Children">
          EFFANT is not directed at children under 13. We do not knowingly collect data from children.
        </Section>

        <Section title="10. Changes">
          We may update this policy. We will notify you by email if changes are material. Continued use after changes constitutes acceptance.
        </Section>

        <Section title="11. Contact">
          Questions about this policy? Email us at billing@effant.tech.
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
