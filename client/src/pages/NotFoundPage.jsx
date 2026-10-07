import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui.jsx';

export default function NotFoundPage({ inApp = false }) {
  const content = (
    <EmptyState
      icon="search"
      title="Page not found"
      description="The page you're looking for doesn't exist or was moved."
      action={<Link to={inApp ? '/app' : '/'} className="text-sm text-brand-500 hover:underline">Go to dashboard</Link>}
    />
  );
  if (inApp) return content;
  return <main className="grid min-h-screen place-items-center bg-ink-900 text-white">{content}</main>;
}
