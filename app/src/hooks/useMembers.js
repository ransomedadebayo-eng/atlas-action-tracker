import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { membersApi } from '../api/client.js';

export function useMembers(params = {}) {
  return useQuery({
    queryKey: ['members', params],
    queryFn: () => membersApi.list(params),
    staleTime: 60000,
  });
}

export function useMember(id) {
  return useQuery({
    queryKey: ['member', id],
    queryFn: () => membersApi.get(id),
    enabled: !!id,
  });
}

export function useMemberStats() {
  return useQuery({
    queryKey: ['memberStats'],
    queryFn: () => membersApi.stats(),
    staleTime: 30000,
  });
}

export function useMemberActions(id, params = {}) {
  return useQuery({
    queryKey: ['memberActions', id, params],
    queryFn: () => membersApi.actions(id, params),
    enabled: !!id,
  });
}

export function useCreateMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => membersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
    },
  });
}

export function useUpdateMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => membersApi.update(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['member', data.id] });
    },
  });
}
