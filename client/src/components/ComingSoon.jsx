// Honest placeholder for modules that are built in later phases.
import PageHeader from './PageHeader.jsx';
import Icon from './icons.jsx';
import useDocumentTitle from '../hooks/useDocumentTitle.js';

export default function ComingSoon({ title, icon = 'sparkles', phase, description, bullets = [] }) {
  useDocumentTitle(title);
  return (
    <>
      <PageHeader title={title} />
      <section className="rounded-2xl bg-ink-800 p-8 ring-1 ring-white/10">
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/10 text-brand-500">
            <Icon name={icon} className="h-7 w-7" />
          </div>
          <span className="inline-flex rounded-full bg-white/5 px-3 py-1 text-xs text-white/60 ring-1 ring-white/10">
            Being built in Phase {phase}
          </span>
          <p className="mt-4 text-white/70">{description}</p>
          {bullets.length > 0 && (
            <ul className="mx-auto mt-5 max-w-md space-y-2 text-left text-sm text-white/60">
              {bullets.map((b) => (
                <li key={b} className="flex gap-2">
                  <Icon name="checkCircle" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
