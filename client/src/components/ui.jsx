import { forwardRef } from 'react';
// Reusable UI pieces. Bigger components live in their own files and are re-exported here,
// so pages can import everything from one place: import { Button, Modal } from '../components/ui.jsx'
export { LoadingState, EmptyState, ErrorState, Skeleton } from './states.jsx';
export { default as Modal } from './Modal.jsx';
export { default as DataTable } from './DataTable.jsx';
export { default as DropdownMenu } from './DropdownMenu.jsx';
export { default as PageHeader } from './PageHeader.jsx';
export { default as Icon } from './icons.jsx';

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function FullPageLoader() {
  return (
    <div className="min-h-screen grid place-items-center bg-ink-900 text-brand-500">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function Logo() {
  return (
    <span className="text-xl font-semibold tracking-tight">
      Lead<span className="text-brand-500">Flow</span> ERP
    </span>
  );
}

export function AuthShell({ title, subtitle, children, footer }) {
  return (
    <main className="min-h-screen bg-ink-900 text-white flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Logo />
        </div>
        <div className="rounded-2xl bg-ink-800 p-8 shadow-xl ring-1 ring-white/10">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-white/60">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-sm text-white/60">{footer}</div>}
        <p className="mt-4 text-center text-xs text-white/35"><a className="hover:underline" href="/privacy">Privacy</a> · <a className="hover:underline" href="/terms">Terms</a></p>
      </div>
    </main>
  );
}

export function Field({ label, error, hint, id, ...inputProps }) {
  const inputId = id || inputProps.name;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-white/80">
        {label}
      </label>
      <input
        id={inputId}
        {...inputProps}
        aria-invalid={Boolean(error)}
        className={`w-full rounded-lg bg-ink-900 px-3 py-2.5 text-white placeholder-white/30 outline-none ring-1 transition focus:ring-2 focus:ring-brand-500 ${
          error ? 'ring-red-500/70' : 'ring-white/10'
        }`}
      />
      {error ? <p className="text-xs text-red-400">{error}</p> : hint && <p className="text-xs text-white/40">{hint}</p>}
    </div>
  );
}

export function Button({ loading, children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-brand-500 hover:bg-brand-600 text-white',
    ghost: 'bg-white/5 hover:bg-white/10 text-white ring-1 ring-white/10',
    danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-300 ring-1 ring-red-500/30',
  };
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-60 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Alert({ type = 'error', children }) {
  if (!children) return null;
  const styles = {
    error: 'bg-red-500/10 text-red-300 ring-red-500/30',
    success: 'bg-brand-500/10 text-brand-50 ring-brand-500/30',
    info: 'bg-white/5 text-white/80 ring-white/10',
  };
  return (
    <div role="alert" className={`rounded-lg px-3 py-2.5 text-sm ring-1 ${styles[type]}`}>
      {children}
    </div>
  );
}

export function Card({ title, action, children }) {
  return (
    <section className="rounded-2xl bg-ink-800 p-6 ring-1 ring-white/10">
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function SelectField({ label, id, name, options, error, ...props }) {
  const selectId = id || name;
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={selectId} className="block text-sm font-medium text-white/80">
          {label}
        </label>
      )}
      <select
        id={selectId}
        name={name}
        {...props}
        className="w-full rounded-lg bg-ink-900 px-3 py-2.5 text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-brand-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

const BADGE_STYLES = {
  green: 'bg-brand-500/15 text-brand-500',
  red: 'bg-red-500/15 text-red-300',
  amber: 'bg-amber-500/15 text-amber-300',
  gray: 'bg-white/10 text-white/70',
  blue: 'bg-sky-500/15 text-sky-300',
};

export function Badge({ color = 'gray', children }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[color]}`}>{children}</span>;
}

export const TENANT_STATUS_COLOR = { TRIAL: 'blue', ACTIVE: 'green', PAST_DUE: 'amber', SUSPENDED: 'red', CANCELLED: 'gray' };
export const SUBSCRIPTION_STATUS_COLOR = { TRIALING: 'blue', ACTIVE: 'green', PAST_DUE: 'amber', SUSPENDED: 'red', CANCELLED: 'gray' };
export const INVOICE_STATUS_COLOR = { OPEN: 'amber', PAID: 'green', VOID: 'gray' };

export const TextArea = forwardRef(function TextArea({ label, error, hint, id, rows = 4, ...props }, ref) {
  const inputId = id || props.name;
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-white/80">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        {...props}
        className={`w-full rounded-lg bg-ink-900 px-3 py-2.5 text-white placeholder-white/30 outline-none ring-1 transition focus:ring-2 focus:ring-brand-500 ${error ? 'ring-red-500/70' : 'ring-white/10'}`}
      />
      {error ? <p className="text-xs text-red-400">{error}</p> : hint && <p className="text-xs text-white/40">{hint}</p>}
    </div>
  );
});

export function ProgressBar({ value, max }) {
  const unlimited = max === -1;
  const pct = unlimited || max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-brand-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={value} aria-valuemax={unlimited ? undefined : max}>
      <div className={`h-full ${unlimited ? 'bg-brand-500/40' : color}`} style={{ width: unlimited ? '100%' : `${pct}%` }} />
    </div>
  );
}

export function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl bg-ink-800 p-5 ring-1 ring-white/10">
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value ?? '—'}</p>
      {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
    </div>
  );
}


export function Pager({ pagination, onPage }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total } = pagination;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-white/60">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" className="px-3 py-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span>Page {page} of {totalPages}</span>
        <Button variant="ghost" className="px-3 py-1.5" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
