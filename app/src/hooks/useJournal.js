import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { journalApi } from '../api/client.js';

export function useJournalEntries(filters = {}) {
  return useQuery({
    queryKey: ['journalEntries', filters],
    queryFn: () => journalApi.list(filters),
    staleTime: 30000,
    placeholderData: keepPreviousData,
  });
}

export function useCreateJournalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => journalApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
    },
  });
}

export function useUpdateJournalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => journalApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
    },
  });
}

export function useArchiveJournalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => journalApi.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
    },
  });
}

export function usePromoteJournalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => journalApi.promote(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['actions'] });
      queryClient.invalidateQueries({ queryKey: ['actionStats'] });
    },
  });
}
