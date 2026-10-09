// Projects & time — PURE helpers (unit-tested).
//   - durations are whole MINUTES (no floating-point hours)
//   - billing: minutes → hours with 3 decimals (quantity in thousandths), rounded to the nearest 0.001 h
// kept here (not imported) so this file has no database dependencies — same values as PROJECT_LIMITS in config/erpOptions.js
const PROJECT_LIMITS = Object.freeze({ minutesPerEntry: 1440, timerMaxMinutes: 720 });

/** "1h 30m" | "1:30" | "90" | "1.5h" | "45m" → minutes, or null. */
export function parseDuration(input) {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s || s.length > 20) return null;
  let m;
  let minutes = null;
  if ((m = /^(\d{1,4})$/.exec(s))) minutes = Number(m[1]);
  else if ((m = /^(\d{1,2}):([0-5]\d)$/.exec(s))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d{1,2}(?:\.\d{1,2})?)\s*h$/.exec(s))) minutes = Math.round(Number(m[1]) * 60);
  else if ((m = /^(?:(\d{1,2})\s*h)?\s*(?:(\d{1,4})\s*m(?:in)?)?$/.exec(s)) && (m[1] || m[2])) minutes = Number(m[1] || 0) * 60 + Number(m[2] || 0);
  return Number.isInteger(minutes) && minutes > 0 && minutes <= PROJECT_LIMITS.minutesPerEntry ? minutes : null;
}

export const formatMinutes = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;

/** 90 min → 1500 (1.5 h); 20 min → 333 (0.333 h). */
export const minutesToQtyMilli = (minutes) => Math.round((minutes * 1000) / 60);

/** Running timer → minutes (at least 1, capped; tells if it was capped). */
export function timerMinutes(startedAt, now = new Date()) {
  const raw = Math.ceil((now.getTime() - new Date(startedAt).getTime()) / 60000);
  const minutes = Math.max(1, raw);
  return minutes > PROJECT_LIMITS.timerMaxMinutes ? { minutes: PROJECT_LIMITS.timerMaxMinutes, capped: true } : { minutes, capped: false };
}

/**
 * Unbilled billable entries → invoice lines: one line per (task, rate), quantity in hours.
 * @param entries [{ _id, taskId, minutes, rateMinor }]
 * @param taskNames Map(taskId → title)
 */
export function timeToInvoiceLines(entries, taskNames, projectName) {
  const groups = new Map();
  for (const e of entries) {
    const key = `${e.taskId || '-'}|${e.rateMinor}`;
    if (!groups.has(key)) groups.set(key, { taskId: e.taskId || null, rateMinor: e.rateMinor, minutes: 0, count: 0 });
    const g = groups.get(key);
    g.minutes += e.minutes;
    g.count += 1;
  }
  return [...groups.values()]
    .filter((g) => g.minutes > 0)
    .map((g) => ({
      description: `${projectName}: ${g.taskId ? taskNames.get(String(g.taskId)) || 'Task' : 'General work'} (${formatMinutes(g.minutes)})`.slice(0, 500),
      unit: 'hour',
      qtyMilli: minutesToQtyMilli(g.minutes),
      unitPriceMinor: g.rateMinor,
      discountBp: 0,
    }));
}

/** Project health numbers for the UI. */
export function projectProgress({ tasks = [], milestones = [], minutesLogged = 0, budgetMinutes = null, now = new Date() }) {
  const done = tasks.filter((t) => t.status === 'DONE').length;
  const overdueTasks = tasks.filter((t) => t.status !== 'DONE' && t.dueDate && new Date(t.dueDate) < now).length;
  return {
    tasksTotal: tasks.length,
    tasksDone: done,
    percentDone: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    overdueTasks,
    milestonesDone: milestones.filter((m) => m.status === 'DONE').length,
    milestonesTotal: milestones.length,
    minutesLogged,
    budgetMinutes,
    budgetUsedPercent: budgetMinutes ? Math.round((minutesLogged / budgetMinutes) * 100) : null,
    overBudget: Boolean(budgetMinutes && minutesLogged > budgetMinutes),
  };
}
