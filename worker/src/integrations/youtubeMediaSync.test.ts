import { describe, expect, it } from 'vitest';
import { assertApplyAuthorization, buildYoutubeSyncManifest, stableJson } from './youtubeMediaSync';

const input={
  week_start:'2026-08-31',
  playlist_title:'00 — This Week',
  current_items:[
    {media_item_id:'current-keep',source_url:'https://www.youtube.com/watch?v=keep-video'},
    {media_item_id:'current-new',source_url:'https://youtu.be/new-video'},
    {media_item_id:'podcast',source_url:'https://podcasts.apple.com/example'},
  ],
  managed_items:[
    {media_item_id:'old',video_id:'old-video',playlist_item_id:'playlist-old'},
    {media_item_id:'keep',video_id:'keep-video',playlist_item_id:'playlist-keep'},
  ],
  playlist_items:[
    {playlist_item_id:'playlist-manual',video_id:'manual-video',title:'Manual choice'},
    {playlist_item_id:'playlist-old',video_id:'old-video',title:'Old Atlas choice'},
    {playlist_item_id:'playlist-keep',video_id:'keep-video',title:'Current Atlas choice'},
  ],
};

describe('YouTube weekly mirror manifest',()=>{
  it('adds missing selections, removes only Atlas-managed stale entries, and preserves manual items',()=>{
    const manifest=buildYoutubeSyncManifest(input);
    expect(manifest.additions).toEqual([{media_item_id:'current-new',video_id:'new-video'}]);
    expect(manifest.removals).toEqual([{media_item_id:'old',playlist_item_id:'playlist-old',video_id:'old-video'}]);
    expect(manifest.kept).toEqual([{media_item_id:'current-keep',playlist_item_id:'playlist-keep',video_id:'keep-video'}]);
    expect(manifest.manual_preserved).toEqual([{playlist_item_id:'playlist-manual',title:'Manual choice',video_id:'manual-video'}]);
  });

  it('is deterministic regardless of source ordering',()=>{
    const first=buildYoutubeSyncManifest(input);
    const second=buildYoutubeSyncManifest({...input,current_items:[...input.current_items].reverse(),playlist_items:[...input.playlist_items].reverse(),managed_items:[...input.managed_items].reverse()});
    expect(stableJson(first)).toBe(stableJson(second));
  });

  it('fails closed unless apply uses the exact staged approval hash',()=>{
    expect(()=>assertApplyAuthorization('manifest-hash',null)).toThrow('YOUTUBE_SYNC_APPROVAL_REQUIRED');
    expect(()=>assertApplyAuthorization('manifest-hash','different')).toThrow('YOUTUBE_SYNC_APPROVAL_MISMATCH');
    expect(()=>assertApplyAuthorization('manifest-hash','manifest-hash')).not.toThrow();
  });
});
