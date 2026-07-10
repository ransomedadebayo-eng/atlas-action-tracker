import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { transcriptsApi } from '../api/client.js';

function transcriptItems(data) {
  return Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
}

export function useTranscripts(params = {}) {
  return useQuery({
    queryKey: ['transcripts', params],
    queryFn: () => transcriptsApi.list(params),
    select: transcriptItems,
    staleTime: 30000,
  });
}

export function useTranscript(id) {
  return useQuery({
    queryKey: ['transcript', id],
    queryFn: () => transcriptsApi.get(id),
    enabled: !!id,
  });
}

export function useCreateTranscript() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => transcriptsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transcripts'] });
      queryClient.invalidateQueries({ queryKey: ['actionStats'] });
    },
  });
}

export function useUpdateTranscript() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => transcriptsApi.update(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['transcripts'] });
      queryClient.invalidateQueries({ queryKey: ['transcript', data.id] });
    },
  });
}
