import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export const SETTINGS_KEY = ['settings'];

export default function useTenantSettings() {
  const { status, access } = useAuth();
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => (await api.get('/settings')).data.data.settings,
    enabled: status === 'authenticated' && access === 'FULL',
    staleTime: 60_000,
  });
}

/** After a save, put the fresh settings returned by the server straight into the cache. */
export function useSetSettings() {
  const queryClient = useQueryClient();
  return (settings) => queryClient.setQueryData(SETTINGS_KEY, settings);
}
