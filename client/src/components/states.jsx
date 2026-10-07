// Loading / empty / error states — used on EVERY page so users never see a blank screen.
import Icon from './icons.jsx';

export function Skeleton({ className = 'h-4 w-full' }) {
  return <div className={`animate-pulse rounded-md bg-white/10 ${className}`} />;
}

export function LoadingState({ rows = 4, label = 'Loading…' }) {
  return (
    <div className="space-y-3" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${i % 3 === 2 ? 'w-2/3' : 'w-full'}`} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, description, action, children }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-white/5 text-white/40">
        <Icon name={icon} className="h-6 w-6" />
      </div>
      {title && <p className="font-medium text-white/80">{title}</p>}
      {(description || children) && <p className="mt-1 max-w-md text-sm text-white/50">{description || children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center" role="alert">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-red-500/10 text-red-300">
        <Icon name="alert" className="h-6 w-6" />
      </div>
      <p className="font-medium text-white/80">{title}</p>
      {message && <p className="mt-1 max-w-md text-sm text-white/50">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg bg-white/5 px-4 py-2 text-sm text-white ring-1 ring-white/10 hover:bg-white/10"
        >
          Try again
        </button>
      )}
    </div>
  );
}
