import { useQuery } from '@tanstack/react-query';
import api from '../lib/api.js';

function StatusPill({ ok, label }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
        ok ? 'bg-brand-50 text-brand-600' : 'bg-red-50 text-red-700'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-brand-500' : 'bg-red-500'}`} />
      {label}
    </span>
  );
}

export default function StatusPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await api.get('/health')).data.data,
    retry: false,
  });

  return (
    <main className="min-h-screen bg-ink-900 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-ink-800 p-8 shadow-xl ring-1 ring-white/10">
        <h1 className="text-2xl font-semibold">
          Lead<span className="text-brand-500">Flow</span> ERP
        </h1>
        <p className="mt-1 text-sm text-white/60">Phase 1 — Project setup</p>

        <div className="mt-8 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-white/80">Frontend</span>
            <StatusPill ok label="Running" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/80">Backend API</span>
            {isLoading ? (
              <span className="text-sm text-white/50">Checking…</span>
            ) : (
              <StatusPill ok={!isError} label={isError ? 'Not reachable' : 'Connected'} />
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/80">MongoDB</span>
            {isLoading ? (
              <span className="text-sm text-white/50">Checking…</span>
            ) : (
              <StatusPill ok={data?.db === 'connected'} label={data?.db ?? 'unknown'} />
            )}
          </div>
        </div>

        <button
          onClick={() => refetch()}
          className="mt-8 w-full rounded-lg bg-brand-500 py-2.5 font-medium text-white hover:bg-brand-600 transition"
        >
          Check again
        </button>
      </div>
    </main>
  );
}
