type CurrentItem={media_item_id:string;source_url?:string|null};
type ManagedItem={media_item_id:string;video_id:string;playlist_item_id:string};
type PlaylistItem={playlist_item_id:string;video_id:string;title?:string};
type ManifestInput={week_start:string;playlist_title:string;current_items:CurrentItem[];managed_items:ManagedItem[];playlist_items:PlaylistItem[]};

export function extractYoutubeVideoId(value:string|null|undefined):string|null{
  if(!value)return null;
  try{
    const url=new URL(value);
    if(url.hostname==='youtu.be')return url.pathname.split('/').filter(Boolean)[0]||null;
    if(url.hostname.endsWith('youtube.com')){
      if(url.pathname==='/watch')return url.searchParams.get('v');
      const parts=url.pathname.split('/').filter(Boolean);if(['shorts','embed','live'].includes(parts[0]))return parts[1]||null;
    }
  }catch{return null}
  return null;
}

function sortBy<T>(rows:T[],key:(row:T)=>string):T[]{return[...rows].sort((a,b)=>key(a).localeCompare(key(b)));}

export function buildYoutubeSyncManifest(input:ManifestInput){
  const current=sortBy(input.current_items.map(item=>({media_item_id:item.media_item_id,video_id:extractYoutubeVideoId(item.source_url)})).filter((item):item is{media_item_id:string;video_id:string}=>Boolean(item.video_id)),item=>item.video_id);
  const managedByPlaylistId=new Map(input.managed_items.map(item=>[item.playlist_item_id,item]));
  const playlistByVideo=new Map(input.playlist_items.map(item=>[item.video_id,item]));
  const currentVideos=new Set(current.map(item=>item.video_id));
  const additions=current.filter(item=>!playlistByVideo.has(item.video_id));
  const kept=current.filter(item=>playlistByVideo.has(item.video_id)).map(item=>({media_item_id:item.media_item_id,playlist_item_id:playlistByVideo.get(item.video_id)!.playlist_item_id,video_id:item.video_id}));
  const removals=input.managed_items.filter(item=>!currentVideos.has(item.video_id)&&input.playlist_items.some(row=>row.playlist_item_id===item.playlist_item_id&&row.video_id===item.video_id)).map(item=>({media_item_id:item.media_item_id,playlist_item_id:item.playlist_item_id,video_id:item.video_id}));
  const manualPreserved=input.playlist_items.filter(item=>!managedByPlaylistId.has(item.playlist_item_id)).map(item=>({playlist_item_id:item.playlist_item_id,title:item.title||'',video_id:item.video_id}));
  return{week_start:input.week_start,playlist_title:input.playlist_title,additions:sortBy(additions,row=>row.video_id),removals:sortBy(removals,row=>row.playlist_item_id),kept:sortBy(kept,row=>row.video_id),manual_preserved:sortBy(manualPreserved,row=>row.playlist_item_id)};
}

function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>[key,canonical(row)]));
  return value;
}

export function stableJson(value:unknown):string{return JSON.stringify(canonical(value));}

export function assertApplyAuthorization(manifestHash:string,approvalHash:string|null|undefined):void{
  if(!approvalHash)throw new Error('YOUTUBE_SYNC_APPROVAL_REQUIRED');
  if(approvalHash!==manifestHash)throw new Error('YOUTUBE_SYNC_APPROVAL_MISMATCH');
}

