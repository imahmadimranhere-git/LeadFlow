// Small building blocks for the "Hashtag Lead Capture Record" (spec A28), used by the Signals inbox
// and the lead page. Every contact shows WHERE it came from — nothing is presented as more than it is.
import { Badge } from '../ui.jsx';
import { ExternalLink } from '../leads/LeadBits.jsx';

export const PROVENANCE_LABEL = {
  POST_TEXT: 'written in the public post',
  PUBLIC_BIO: 'public profile bio',
  BUSINESS_CONTACT_BUTTON: 'business contact button',
  LEAD_FORM: 'submitted in your form',
  USER_ENTERED: 'typed in by your team',
  CSV_IMPORT: 'from a CSV import',
};

export const COMPLETENESS = {
  COMPLETE: ['green', 'Complete'],
  PARTIAL: ['amber', 'Partial'],
  MINIMAL: ['gray', 'Minimal'],
};

export const LAWFUL_BASES = [
  ['LEGITIMATE_INTEREST', 'Legitimate interest'],
  ['CONSENT', 'Consent'],
  ['CONTRACT', 'Contract'],
  ['OTHER', 'Other'],
];
export const CONSENT_STATUSES = [
  ['NONE', 'None recorded'],
  ['REQUESTED', 'Requested'],
  ['GIVEN', 'Given'],
  ['WITHDRAWN', 'Withdrawn (opt-out)'],
];

export function CompletenessBadge({ level }) {
  if (!level) return null;
  const [color, text] = COMPLETENESS[level] || ['gray', level];
  return <Badge color={color}>{text} data</Badge>;
}

export function AuthorLine({ author }) {
  if (!author || author.status === 'NOT_PROVIDED_BY_SOURCE') {
    return <span className="text-white/50">Not provided by the platform — open the post to see who wrote it</span>;
  }
  return (
    <span>
      {author.displayName || '—'}
      {author.handle && <span className="text-white/50"> @{author.handle}</span>}
      {author.status === 'USER_ENTERED' && <span className="ml-2 text-xs text-amber-300">(typed in by your team)</span>}
      {author.profileUrl && <> · <ExternalLink href={author.profileUrl} className="text-xs">profile</ExternalLink></>}
    </span>
  );
}

export function ContactList({ contacts }) {
  if (!contacts?.length) return <span className="text-white/40">No public contact</span>;
  return (
    <ul className="space-y-1">
      {contacts.map((c, i) => (
        <li key={`${c.type}-${i}`} className="text-sm">
          <span className="text-white/45">{c.type.toLowerCase()}: </span>
          {c.type === 'WEBSITE' ? <ExternalLink href={c.value} /> : <span className="font-mono">{c.value}</span>}
          <span className="ml-2 text-xs text-white/40">— {PROVENANCE_LABEL[c.provenance] || c.provenance}</span>
        </li>
      ))}
    </ul>
  );
}
