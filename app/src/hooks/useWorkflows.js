import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { triageApi, workflowsApi } from '../api/client.js'

function invalidate(client) {
  client.invalidateQueries({ queryKey: ['workflow'] })
  client.invalidateQueries({ queryKey: ['triage'] })
  client.invalidateQueries({ queryKey: ['actions'] })
  client.invalidateQueries({ queryKey: ['action'] })
}

export function useWorkflow(business) {
  return useQuery({
    queryKey: ['workflow', business || 'workspace'],
    queryFn: () => workflowsApi.list(business),
    staleTime: 15000,
  })
}

export function useTriage(business, includeSnoozed = false) {
  return useQuery({
    queryKey: ['triage', business || 'workspace', includeSnoozed],
    queryFn: () => triageApi.list(business, includeSnoozed),
    staleTime: 10000,
  })
}

function mutation(call) {
  return function useWorkflowMutation() {
    const client = useQueryClient()
    return useMutation({ mutationFn: call, onSuccess: () => invalidate(client) })
  }
}

export const useUpdateWorkflow = mutation(({ id, ...data }) => workflowsApi.update(id, data))
export const useCreateWorkflowStatus = mutation(({ workflowId, ...data }) => workflowsApi.createStatus(workflowId, data))
export const useUpdateWorkflowStatus = mutation(({ workflowId, statusId, ...data }) => workflowsApi.updateStatus(workflowId, statusId, data))
export const useArchiveWorkflowStatus = mutation(({ workflowId, statusId, ...data }) => workflowsApi.archiveStatus(workflowId, statusId, data))
export const useReorderWorkflowStatuses = mutation(({ workflowId, status_ids }) => workflowsApi.reorderStatuses(workflowId, status_ids))
export const useUpdateTriageSettings = mutation(({ workflowId, ...data }) => workflowsApi.updateTriageSettings(workflowId, data))
export const useCreateWorkflowRule = mutation(({ workflowId, ...data }) => workflowsApi.createRule(workflowId, data))
export const useUpdateWorkflowRule = mutation(({ workflowId, ruleId, ...data }) => workflowsApi.updateRule(workflowId, ruleId, data))
export const useTransitionWorkflowRule = mutation(({ workflowId, ruleId, transition, ...data }) => workflowsApi.transitionRule(workflowId, ruleId, transition, data))
export const usePreviewWorkflowRule = mutation(({ workflowId, ruleId, ...data }) => workflowsApi.previewRule(workflowId, ruleId, data))
export const useEvaluateWorkflow = mutation(({ workflowId, ...data }) => workflowsApi.evaluate(workflowId, data))
export const usePreviewInactivity = mutation(({ workflowId, ...data }) => workflowsApi.previewInactivity(workflowId, data))
export const useApplyInactivity = mutation(({ workflowId, ...data }) => workflowsApi.applyInactivity(workflowId, data))
export const useEnterTriage = mutation(({ actionId, ...data }) => triageApi.enter(actionId, data))
export const useAcceptTriage = mutation(({ actionId, ...data }) => triageApi.accept(actionId, data))
export const useDeclineTriage = mutation(({ actionId, ...data }) => triageApi.decline(actionId, data))
export const useDuplicateTriage = mutation(({ actionId, ...data }) => triageApi.duplicate(actionId, data))
export const useSnoozeTriage = mutation(({ actionId, ...data }) => triageApi.snooze(actionId, data))
