// Generic table: columns config + rows. Handles loading, empty and horizontal scroll on mobile.
// Cell values are rendered as React text (auto-escaped) — never as HTML.
import { LoadingState, EmptyState } from './states.jsx';

export default function DataTable({ columns, rows, rowKey = (r) => r.id, loading, empty }) {
  if (loading) return <LoadingState rows={5} />;
  if (!rows || rows.length === 0) return empty || <EmptyState title="Nothing here yet" />;

  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="text-left text-white/50">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-2 py-2 font-medium ${c.className || ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-white/[0.03]">
              {columns.map((c) => (
                <td key={c.key} className={`px-2 py-3 align-middle ${c.className || ''}`}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
