import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { decideApi } from '../api/client.js';

export function useDecisionQueue() {
  return useQuery({
    queryKey: ['decisionQueue'],
    queryFn: () => decideApi.get(),
    staleTime: 30000,
  });
}

export function useDecideProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }) => decideApi.decideProposal(id, { decision, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decisionQueue'] });
    },
  });
}
