import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { integrationsApi, notificationsApi } from '../api/client.js'

function invalidate(client) {
  client.invalidateQueries({ queryKey: ['notifications'] })
  client.invalidateQueries({ queryKey: ['notificationSummary'] })
  client.invalidateQueries({ queryKey: ['integrations'] })
}

export function useNotifications(params = {}) {
  return useQuery({ queryKey: ['notifications', params], queryFn: () => notificationsApi.list(params), staleTime: 10000 })
}
export function useNotificationSummary() {
  return useQuery({ queryKey: ['notificationSummary'], queryFn: notificationsApi.summary, staleTime: 10000 })
}
export function useIntegrations() {
  return useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list, staleTime: 10000 })
}
function mutation(call) {
  return function useNotificationMutation() { const client = useQueryClient(); return useMutation({ mutationFn: call, onSuccess: () => invalidate(client) }) }
}
export const useTransitionNotification = mutation(({ id, status, ...data }) => notificationsApi.transition(id, status, data))
export const useReadAllNotifications = mutation(() => notificationsApi.readAll())
export const useUpdateNotificationPreference = mutation(notificationsApi.updatePreference)
export const useCreateNotificationSubscription = mutation(notificationsApi.subscribe)
export const useTransitionNotificationSubscription = mutation(({ id, transition, ...data }) => notificationsApi.transitionSubscription(id, transition, data))
export const useCreateIntegrationConnection = mutation(integrationsApi.createConnection)
export const useUpdateIntegrationConnection = mutation(({ id, ...data }) => integrationsApi.updateConnection(id, data))
export const useVerifyIntegrationConnection = mutation(({ id, ...data }) => integrationsApi.verifyConnection(id, data))
export const useTransitionIntegrationConnection = mutation(({ id, transition, ...data }) => integrationsApi.transitionConnection(id, transition, data))
export const useCreateIntegrationSubscription = mutation(({ connectionId, ...data }) => integrationsApi.createSubscription(connectionId, data))
export const useTransitionIntegrationSubscription = mutation(({ id, transition, ...data }) => integrationsApi.transitionSubscription(id, transition, data))
export const useProcessIntegrationDeliveries = mutation(integrationsApi.processDeliveries)
export const useTransitionInboundEvent = mutation(({ id, transition, ...data }) => integrationsApi.transitionInbound(id, transition, data))
