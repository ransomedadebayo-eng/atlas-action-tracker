import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { releasesApi } from '../api/client.js';

export function useReleasePipelines(filters={}){return useQuery({queryKey:['releasePipelines',filters],queryFn:()=>releasesApi.pipelines(filters),staleTime:30000})}
export function useReleasePipeline(id){return useQuery({queryKey:['releasePipeline',id],queryFn:()=>releasesApi.pipeline(id),enabled:Boolean(id),staleTime:15000})}
export function useRelease(id){return useQuery({queryKey:['release',id],queryFn:()=>releasesApi.release(id),enabled:Boolean(id),staleTime:15000})}
export function useReleaseChangelog(id){return useQuery({queryKey:['releaseChangelog',id],queryFn:()=>releasesApi.changelog(id),enabled:Boolean(id),staleTime:30000})}
function invalidate(client,id){client.invalidateQueries({queryKey:['releasePipelines']});if(id)client.invalidateQueries({queryKey:['releasePipeline',id]});client.invalidateQueries({queryKey:['release']});client.invalidateQueries({queryKey:['releaseChangelog']});client.invalidateQueries({queryKey:['actions']});client.invalidateQueries({queryKey:['action']})}
function mutation(apiCall,pipelineFromVariables=variables=>variables.pipelineId){return function useReleaseMutation(){const client=useQueryClient();return useMutation({mutationFn:apiCall,onSuccess:(_data,variables)=>invalidate(client,pipelineFromVariables(variables))})}}
export function useCreateReleasePipeline(){const client=useQueryClient();return useMutation({mutationFn:releasesApi.createPipeline,onSuccess:()=>invalidate(client)})}
export const useUpdateReleasePipeline=mutation(({pipelineId,...data})=>releasesApi.updatePipeline(pipelineId,data));
export const useArchiveReleasePipeline=mutation(({pipelineId,...data})=>releasesApi.archivePipeline(pipelineId,data));
export const useRestoreReleasePipeline=mutation(({pipelineId,...data})=>releasesApi.restorePipeline(pipelineId,data));
export const useSetReleaseAccessKey=mutation(({pipelineId,...data})=>releasesApi.setAccessKey(pipelineId,data));
export const useCreateReleaseStage=mutation(({pipelineId,...data})=>releasesApi.createStage(pipelineId,data));
export const useUpdateReleaseStage=mutation(({pipelineId,stageId,...data})=>releasesApi.updateStage(pipelineId,stageId,data));
export const useCreateRelease=mutation(({pipelineId,...data})=>releasesApi.createRelease(pipelineId,data));
export const useUpdateRelease=mutation(({pipelineId,releaseId,...data})=>releasesApi.updateRelease(releaseId,data));
export const useAttachReleaseAction=mutation(({pipelineId,releaseId,actionId,...data})=>releasesApi.attachAction(releaseId,actionId,data));
export const useDetachReleaseAction=mutation(({pipelineId,releaseId,actionId})=>releasesApi.detachAction(releaseId,actionId));
export const useTransitionReleaseStage=mutation(({pipelineId,stageRunId,...data})=>releasesApi.transitionStage(stageRunId,data));
export const useTransitionRelease=mutation(({pipelineId,releaseId,...data})=>releasesApi.transitionRelease(releaseId,data));
export const useRestoreRelease=mutation(({pipelineId,releaseId,...data})=>releasesApi.restoreRelease(releaseId,data));
export const useGenerateReleaseNotes=mutation(({pipelineId,releaseId})=>releasesApi.generateNotes(releaseId));
