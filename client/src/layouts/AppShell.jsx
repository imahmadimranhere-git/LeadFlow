// Responsive shell: fixed sidebar on desktop, slide-in drawer on mobile.
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Icon from '../components/icons.jsx';
import { Logo } from '../components/ui.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';

function NavContent({ groups, footer, subtitle }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-4 pt-5">
        <Logo />
        {subtitle && <p className="mt-1 truncate text-xs text-white/40">{subtitle}</p>}
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {groups.map((group, gi) => (
          <div key={group.label || gi}>
            {group.label && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/30">{group.label}</p>}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                        isActive ? 'bg-brand-500/15 font-medium text-brand-500' : 'text-white/65 hover:bg-white/5 hover:text-white'
                      }`
                    }
                  >
                    <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.phase && <span className="rounded bg-white/5 px-1.5 text-[10px] text-white/30">soon</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {footer && <div className="border-t border-white/10 p-3">{footer}</div>}
    </div>
  );
}

export default function AppShell({ groups, subtitle, topBar, sidebarFooter, banner, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]); // close drawer after navigating

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-ink-900 text-white">
      {banner}
      {/* Desktop sidebar */}
      <aside className={`fixed bottom-0 left-0 hidden w-64 border-r border-white/10 bg-ink-900 lg:block ${banner ? 'top-8' : 'top-0'}`}>
        <NavContent groups={groups} footer={sidebarFooter} subtitle={subtitle} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-ink-900 shadow-2xl ring-1 ring-white/10">
            <NavContent groups={groups} footer={sidebarFooter} subtitle={subtitle} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/10 bg-ink-900/90 px-4 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 lg:hidden" aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-3">{topBar}</div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
          <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
