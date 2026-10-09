// Lead page: "Create quote" and "Convert to client" (idempotent — opens the existing client if there is one).
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useToast } from '../Toast.jsx';
import { Button } from '../ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';

export default function LeadSalesActions({ lead }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const convert = useMutation({
    mutationFn: async () => (await api.post(`/clients/from-lead/${lead.id}`)).data.data,
    onSuccess: (r) => {
      toast.success(r.created ? 'Client created — lead marked as converted' : 'Opening the existing client');
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      navigate(`/app/contacts/${r.client.id}`);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" onClick={() => navigate(`/app/quotes/new?leadId=${lead.id}`)}>Create quote</Button>
      <Button variant="ghost" loading={convert.isPending} onClick={() => convert.mutate()}>{lead.status === 'CONVERTED' ? 'Open client' : 'Convert to client'}</Button>
    </div>
  );
}
