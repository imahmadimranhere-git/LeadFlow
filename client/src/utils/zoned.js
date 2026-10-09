// Show a date in the COMPANY's time zone (follow-ups are planned in company time).
export function formatInZone(date, timeZone, opts = {}) {
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', ...opts }).format(new Date(date));
  } catch {
    return new Date(date).toLocaleString();
  }
}

/** Browser-local "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
export function toLocalInput(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Quick choices: tomorrow / in 3 days / next week — at 10:00 browser time. */
export function snoozeDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
  return d;
}
