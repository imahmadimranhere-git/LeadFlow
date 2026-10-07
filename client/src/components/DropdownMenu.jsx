// Small dropdown: closes on outside click and Esc.
import { useEffect, useRef, useState } from 'react';

export default function DropdownMenu({ trigger, items, align = 'right', label = 'Open menu' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visible = items.filter((i) => !i.hidden);
  if (visible.length === 0) return null;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg px-2 py-1.5 text-white/70 hover:bg-white/10 hover:text-white"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-40 mt-1 min-w-[180px] rounded-xl bg-ink-800 py-1 shadow-xl ring-1 ring-white/10 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`block w-full px-3 py-2 text-left text-sm disabled:opacity-40 ${item.danger ? 'text-red-300 hover:bg-red-500/10' : 'text-white/80 hover:bg-white/5'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
