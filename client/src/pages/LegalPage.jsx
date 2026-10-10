// Public Privacy Policy + Terms (spec 18). TEMPLATE text — company details come from config/legal.js.
// Until a lawyer has reviewed it (LEGAL.reviewed = true) a "Draft" notice is shown — honest by default.
import { Link } from 'react-router-dom';
import { LEGAL } from '../config/legal.js';
import { Logo } from '../components/ui.jsx';
import useDocumentTitle from '../hooks/useDocumentTitle.js';

const S = ({ title, children }) => (
  <section className="mt-8">
    <h2 className="text-lg font-semibold">{title}</h2>
    <div className="mt-2 space-y-2 text-sm leading-relaxed text-white/75">{children}</div>
  </section>
);

function Privacy() {
  const L = LEGAL;
  return (
    <>
      <S title="Who we are">
        <p>{L.serviceName} is provided by {L.companyName}, {L.address}. Contact for privacy questions: {L.contactEmail}.</p>
        <p>Companies ("customers") use {L.serviceName} to find, manage and contact business leads and to run sales, invoicing and projects. For the leads and contacts a customer stores, the <b>customer</b> decides what is collected and why (they are the controller); we process it on their behalf.</p>
      </S>
      <S title="What we collect">
        <p><b>Account data:</b> name, email, password (stored only as a one-way hash), role, login times, and security events such as failed logins.</p>
        <p><b>Customer data:</b> whatever a customer adds — leads, public business contact details and where they were found, messages, quotes, invoices, projects, files.</p>
        <p><b>Technical data:</b> IP address (shown to you only partly masked), browser type, and logs needed to keep the service secure. We do not use advertising trackers.</p>
      </S>
      <S title="Why we use it">
        <p>To provide the service, keep it secure (fraud and abuse prevention, audit logs), send service emails (password reset, confirmations), bill subscriptions, and meet legal obligations.</p>
      </S>
      <S title="Who we share it with">
        <p>Only with providers that run the service for us:</p>
        <ul className="list-disc pl-5">{L.processors.map(([n, w]) => <li key={n}><b>{n}</b> — {w}</li>)}</ul>
        <p>We do not sell personal data.</p>
      </S>
      <S title="How long we keep it">
        <p>Account and customer data are kept while the account is active. Export files are deleted after 24 hours, notifications after 90 days, AI usage records after about 13 months. When a company account is closed, access stops immediately. To have the data permanently erased, the account owner writes to {L.contactEmail}; we erase it within [30] days, except records the law requires us to keep (for example invoices).</p>
      </S>
      <S title="Your rights">
        <p>You can ask for a copy of your data, correction, deletion, or to object to processing, by writing to {L.contactEmail}. People listed as leads by a customer can also ask that customer directly, and can unsubscribe from emails with the link in every email. Requests to be put on a do-not-contact list are honored.</p>
      </S>
      <S title="Security">
        <p>Encryption in transit (HTTPS), encrypted storage of integration keys, hashed passwords, optional two-step login, strict separation between companies, and audit logs. No system is perfectly secure; we will inform affected customers about a breach as required by law.</p>
      </S>
      <S title="Changes">
        <p>We will announce important changes in the app or by email before they take effect.</p>
      </S>
    </>
  );
}

function Terms() {
  const L = LEGAL;
  return (
    <>
      <S title="The service">
        <p>These terms are an agreement between you (and the company you sign up for) and {L.companyName} for using {L.serviceName}.</p>
      </S>
      <S title="Your account">
        <p>Keep your password secret and turn on two-step login. You are responsible for what happens under your account and for the people you invite.</p>
      </S>
      <S title="Lawful use — your responsibility">
        <p>You may only collect, store and contact people as the law and the rules of each platform allow (consent, anti-spam, privacy, platform terms of Google, Meta, LinkedIn and others). Messages are sent only after a person in your company approves them. Respect unsubscribe and do-not-contact requests.</p>
        <p>Not allowed: spam, scraping against a platform's rules, illegal content, attacking or overloading the service, or trying to access another company's data.</p>
      </S>
      <S title="AI features">
        <p>AI suggestions (scores, messages, replies) can be wrong. Review them before relying on them or sending anything. Costs shown in the app are estimates.</p>
      </S>
      <S title="Plans and payment">
        <p>Paid plans renew per period until cancelled. Plan limits apply. If payment fails, the account may be limited to billing until it is paid.</p>
      </S>
      <S title="Your data">
        <p>Your company owns its data. You can export it at any time. See the Privacy Policy for how we handle it.</p>
      </S>
      <S title="Availability and liability">
        <p>We work to keep the service available and secure, but it is provided "as is" without guarantee of uninterrupted operation. To the extent the law allows, our liability is limited to the fees paid in the last 12 months.</p>
      </S>
      <S title="Ending">
        <p>You can stop using the service at any time. We may suspend accounts that break these terms or the law.</p>
      </S>
      <S title="Law">
        <p>These terms are governed by the laws of {L.governingLaw}. Contact: {L.contactEmail}.</p>
      </S>
    </>
  );
}

export default function LegalPage({ kind }) {
  const title = kind === 'terms' ? 'Terms of Service' : 'Privacy Policy';
  useDocumentTitle(title);
  return (
    <main className="min-h-screen bg-ink-900 px-4 py-10 text-white">
      <article className="mx-auto max-w-2xl">
        <Link to="/" aria-label="Home"><Logo /></Link>
        <h1 className="mt-8 text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-xs text-white/45">Effective: {LEGAL.effectiveDate}</p>
        {!LEGAL.reviewed && (
          <p className="mt-4 rounded-lg bg-amber-500/15 p-3 text-sm text-amber-100 ring-1 ring-amber-500/30">Draft — this text has not yet been reviewed by a lawyer and may change.</p>
        )}
        {kind === 'terms' ? <Terms /> : <Privacy />}
        <p className="mt-10 text-sm text-white/50"><Link className="underline" to={kind === 'terms' ? '/privacy' : '/terms'}>{kind === 'terms' ? 'Privacy Policy' : 'Terms of Service'}</Link> · <Link className="underline" to="/login">Log in</Link></p>
      </article>
    </main>
  );
}
