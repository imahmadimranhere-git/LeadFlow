// Accessible modal: Esc closes, focus moves inside and comes back, page scroll locked.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './icons.jsx';

export default function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const panelRef = useRef(null);
  const lastFocused = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose; // always call the latest onClose without re-running the effect

  useEffect(() => {
    if (!open) return undefined;
    lastFocused.current = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const focusable = panelRef.current?.querySelector('input, select, textarea, button:not([data-close])');
    (focusable || panelRef.current)?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      lastFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative w-full ${width} rounded-2xl bg-ink-800 text-white shadow-2xl ring-1 ring-white/10 outline-none`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" data-close onClick={onClose} className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
