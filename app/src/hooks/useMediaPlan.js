import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mediaApi } from '../api/client.js';

export function useMediaPlan(weekStart=null){
  return useQuery({
    queryKey:['mediaPlan',weekStart||'current'],
    queryFn:()=>weekStart?mediaApi.get(weekStart):mediaApi.current(),
    staleTime:30000,
  });
}

export function useUpdateMediaStatus(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:({id,...data})=>mediaApi.updateStatus(id,{...data,idempotency_key:data.idempotency_key||crypto.randomUUID()}),
    onSuccess:()=>queryClient.invalidateQueries({queryKey:['mediaPlan']}),
  });
}

export function useStartTwitterAllowance(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:({date,...data})=>mediaApi.startTwitter(date,{...data,idempotency_key:data.idempotency_key||crypto.randomUUID()}),
    onSuccess:()=>queryClient.invalidateQueries({queryKey:['mediaPlan']}),
  });
}

export function useRecordMediaFeedback(){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:({id,...data})=>mediaApi.recordFeedback(id,{...data,idempotency_key:data.idempotency_key||crypto.randomUUID()}),
    onSuccess:()=>queryClient.invalidateQueries({queryKey:['mediaPlan']}),
  });
}
