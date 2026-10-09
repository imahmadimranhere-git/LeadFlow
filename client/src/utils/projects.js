export const PROJECT_STATUS = { PLANNED: ['gray', 'Planned'], ACTIVE: ['green', 'Active'], ON_HOLD: ['amber', 'On hold'], COMPLETED: ['blue', 'Completed'], CANCELLED: ['gray', 'Cancelled'] };
export const TASK_COLUMNS = [['TODO', 'To do'], ['IN_PROGRESS', 'In progress'], ['REVIEW', 'Review'], ['DONE', 'Done']];
export const TASK_PRIORITY = { LOW: ['gray', 'Low'], MEDIUM: ['blue', 'Medium'], HIGH: ['amber', 'High'], URGENT: ['red', 'Urgent'] };
export const fmtMinutes = (m) => `${Math.floor((m || 0) / 60)}h ${String((m || 0) % 60).padStart(2, '0')}m`;
/** "YYYY-MM-DD" in the browser's local time (the server checks it is not in the future for the company). */
export const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
