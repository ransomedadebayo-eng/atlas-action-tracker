import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { configApi } from '../api/client.js';

export function useEstimateSettings() {
  return useQuery({
    queryKey: ['estimateSettings'],
    queryFn: configApi.estimates,
    staleTime: 60000,
  });
}

export function useUpdateEstimateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: configApi.updateEstimates,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['estimateSettings'] }),
  });
}
