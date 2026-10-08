// Form building blocks for lists: TagInput (chips), ToggleChips (multi-select) and ServicesEditor.
import { useState } from 'react';
import Icon from './icons.jsx';

export function TagInput({ label, value = [], onChange, placeholder = 'Type and press Enter', hint, max = 100, normalize = (s) => s.trim(), prefix = '', disabled, error, id }) {
  const [draft, setDraft] = useState('');
  const inputId = id || label?.toLowerCase().replace(/\W+/g, '-');

  const add = (raw) => {
    const items = raw.split(/[\n,]+/).map(normalize).filter(Boolean);
    if (items.length === 0) return;
    const seen = new Set(value.map((v) => v.toLocaleLowerCase()));
    const next = [...value];
    for (const item of items) {
      if (next.length >= max) break;
      if (!seen.has(item.toLocaleLowerCase())) {
        seen.add(item.toLocaleLowerCase());
        next.push(item);
      }
    }
    onChange(next);
    setDraft('');
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="flex justify-between text-sm font-medium text-white/80">
          <span>{label}</span>
          <span className="text-xs font-normal text-white/30">{value.length}/{max}</span>
        </label>
      )}
      <div className={`flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-lg bg-ink-900 px-2 py-1.5 ring-1 focus-within:ring-2 focus-within:ring-brand-500 ${error ? 'ring-red-500/70' : 'ring-white/10'}`}>
        {value.map((item) => (
          <span key={item} className="inline-flex max-w-full items-center gap-1 rounded-md bg-brand-500/15 px-2 py-1 text-xs text-brand-500">
            <span className="truncate">{prefix}{item}</span>
            {!disabled && (
              <button type="button" onClick={() => onChange(value.filter((v) => v !== item))} className="text-brand-500/70 hover:text-white" aria-label={`Remove ${item}`}>
                <Icon name="x" className="h-3 w-3" strokeWidth={2.5} />
              </button>
            )}
          </span>
        ))}
        {!disabled && value.length < max && (
          <input
            id={inputId}
            value={draft}
            placeholder={value.length ? '' : placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                add(draft);
              } else if (e.key === 'Backspace' && !draft && value.length) {
                onChange(value.slice(0, -1));
              }
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              if (/[\n,]/.test(text)) {
                e.preventDefault();
                add(text);
              }
            }}
            onBlur={() => draft && add(draft)}
            className="min-w-[120px] flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-white/30 outline-none"
          />
        )}
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : hint && <p className="text-xs text-white/40">{hint}</p>}
    </div>
  );
}

export function ToggleChips({ label, options, value = [], onChange, disabled }) {
  const toggle = (opt) => onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  return (
    <fieldset disabled={disabled}>
      {label && <legend className="mb-2 text-sm font-medium text-white/80">{label}</legend>}
      <div className="flex flex-wrap gap-2">
        {options.map(([key, text]) => (
          <label
            key={key}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs ring-1 transition ${value.includes(key) ? 'bg-brand-500/15 text-brand-500 ring-brand-500/40' : 'text-white/60 ring-white/10 hover:bg-white/5'} ${disabled ? 'cursor-default opacity-70' : ''}`}
          >
            <input type="checkbox" className="sr-only" checked={value.includes(key)} onChange={() => toggle(key)} />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ServicesEditor({ value = [], onChange, disabled, max = 50 }) {
  const update = (i, key, v) => onChange(value.map((s, idx) => (idx === i ? { ...s, [key]: v } : s)));
  const inputClass = 'w-full rounded-lg bg-ink-900 px-3 py-2 text-sm text-white placeholder-white/30 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-brand-500';
  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="text-sm text-white/40">No services yet.</p>}
      {value.map((s, i) => (
        <div key={i} className="grid gap-2 rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/10 sm:grid-cols-[1fr_2fr_auto]">
          <input aria-label="Service name" className={inputClass} placeholder="Service name" maxLength={80} value={s.name} disabled={disabled} onChange={(e) => update(i, 'name', e.target.value)} />
          <input aria-label="Short description" className={inputClass} placeholder="Short description (optional)" maxLength={300} value={s.description || ''} disabled={disabled} onChange={(e) => update(i, 'description', e.target.value)} />
          {!disabled && (
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="rounded-lg px-2 text-white/40 hover:bg-red-500/10 hover:text-red-300" aria-label={`Remove ${s.name || 'service'}`}>
              <Icon name="x" className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      {!disabled && value.length < max && (
        <button type="button" onClick={() => onChange([...value, { name: '', description: '' }])} className="inline-flex items-center gap-1.5 text-sm text-brand-500 hover:underline">
          <Icon name="plus" className="h-4 w-4" /> Add service
        </button>
      )}
    </div>
  );
}
