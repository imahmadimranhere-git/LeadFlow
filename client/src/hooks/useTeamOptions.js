import { useQuery } from '@tanstack/react-query';
import api from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

/** Active team members for "assign to" dropdowns (only loaded for people who may assign). */
export default function useTeamOptions() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['users', 'options'],
    queryFn: async () => (await api.get('/users', { params: { limit: 100, sort: 'name' } })).data.data.items.filter((u) => u.status === 'ACTIVE'),
    enabled: can('leads:assign'),
    staleTime: 60_000,
  });
}
