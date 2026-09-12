#!/usr/bin/env -S node --experimental-strip-types
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildYoutubeSyncManifest, stableJson, assertApplyAuthorization } from '../worker/src/integrations/youtubeMediaSync.ts';

type Args={input?:string;tokenFile?:string;clientSecretFile?:string;apply:boolean;approvalHash?:string};
function parseArgs(argv:string[]):Args{
  const result:Args={apply:false};
  for(let i=0;i<argv.length;i+=1){const arg=argv[i];if(arg==='--apply')result.apply=true;else if(arg==='--input')result.input=argv[++i];else if(arg==='--token-file')result.tokenFile=argv[++i];else if(arg==='--client-secret-file')result.clientSecretFile=argv[++i];else if(arg==='--approval-hash')result.approvalHash=argv[++i];else if(arg==='--dry-run')result.apply=false;else throw new Error(`UNKNOWN_ARGUMENT:${arg}`)}
  return result;
}

async function jsonFile(path:string|undefined,label:string){
  if(!path)throw new Error(`${label}_REQUIRED`);
  if(path==='-'){const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  return JSON.parse(await readFile(path,'utf8'));
}
async function accessToken(tokenFile:string,clientSecretFile:string):Promise<string>{
  const token=await jsonFile(tokenFile,'YOUTUBE_TOKEN_FILE');
  if(token.access_token&&Number(token.expires_at||0)>Date.now()+60_000)return token.access_token;
  const secretFile=await jsonFile(clientSecretFile,'YOUTUBE_CLIENT_SECRET_FILE');const secret=secretFile.installed||secretFile.web||secretFile;
  if(!token.refresh_token||!secret.client_id||!secret.client_secret)throw new Error('YOUTUBE_REFRESH_CONFIGURATION_INVALID');
  const response=await fetch(secret.token_uri||'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:secret.client_id,client_secret:secret.client_secret,refresh_token:token.refresh_token,grant_type:'refresh_token'})});
  if(!response.ok)throw new Error(`YOUTUBE_TOKEN_REFRESH_FAILED:${response.status}`);const refreshed=await response.json() as{access_token?:string};if(!refreshed.access_token)throw new Error('YOUTUBE_TOKEN_REFRESH_EMPTY');return refreshed.access_token;
}

async function youtubeRequest(token:string,path:string,init:RequestInit={}):Promise<any>{
  const response=await fetch(`https://www.googleapis.com/youtube/v3${path}`,{...init,headers:{authorization:`Bearer ${token}`,...init.headers}});if(response.status===204)return null;
  const text=await response.text();
  if(!response.ok){let reason='unknown';try{const parsed=JSON.parse(text);reason=parsed?.error?.errors?.[0]?.reason||parsed?.error?.status||'unknown'}catch{}throw new Error(`YOUTUBE_API_FAILED:${response.status}:${reason}`)}
  return text?JSON.parse(text):null;
}
async function listPlaylists(token:string){let pageToken='';const rows:any[]=[];do{const query=new URLSearchParams({part:'snippet,status',mine:'true',maxResults:'50'});if(pageToken)query.set('pageToken',pageToken);const page=await youtubeRequest(token,`/playlists?${query}`);rows.push(...(page.items||[]));pageToken=page.nextPageToken||''}while(pageToken);return rows;}
async function listPlaylistItems(token:string,playlistId:string){let pageToken='';const rows:any[]=[];do{const query=new URLSearchParams({part:'snippet,contentDetails',playlistId,maxResults:'50'});if(pageToken)query.set('pageToken',pageToken);const page=await youtubeRequest(token,`/playlistItems?${query}`);rows.push(...(page.items||[]));pageToken=page.nextPageToken||''}while(pageToken);return rows.map(item=>({playlist_item_id:item.id,video_id:item.contentDetails?.videoId||item.snippet?.resourceId?.videoId,title:item.snippet?.title||''})).filter(item=>item.video_id);}

async function main(){
  const args=parseArgs(process.argv.slice(2));const input=await jsonFile(args.input,'INPUT');
  const token=await accessToken(args.tokenFile||process.env.YOUTUBE_TOKEN_FILE||'',args.clientSecretFile||process.env.YOUTUBE_CLIENT_SECRET_FILE||'');
  const playlists=await listPlaylists(token);const matches=playlists.filter(row=>row.snippet?.title===input.playlist_title);
  if(matches.length!==1)throw new Error(matches.length?'YOUTUBE_PLAYLIST_AMBIGUOUS':'YOUTUBE_PLAYLIST_NOT_FOUND');
  const playlist=matches[0];if(playlist.status?.privacyStatus!=='private')throw new Error('YOUTUBE_PLAYLIST_NOT_PRIVATE');
  const playlistItems=await listPlaylistItems(token,playlist.id);const manifest=buildYoutubeSyncManifest({...input,playlist_items:playlistItems});const manifestHash=createHash('sha256').update(stableJson(manifest)).digest('hex');
  if(!args.apply){process.stdout.write(`${JSON.stringify({mode:'dry_run',playlist_id:playlist.id,manifest_hash:manifestHash,manifest},null,2)}\n`);return;}
  assertApplyAuthorization(manifestHash,args.approvalHash);
  for(const item of manifest.removals)await youtubeRequest(token,`/playlistItems?id=${encodeURIComponent(item.playlist_item_id)}`,{method:'DELETE'});
  const appliedAdds=[];for(const item of manifest.additions){const created=await youtubeRequest(token,'/playlistItems?part=snippet',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snippet:{playlistId:playlist.id,resourceId:{kind:'youtube#video',videoId:item.video_id}}})});appliedAdds.push({...item,playlist_item_id:created.id})}
  const readback=await listPlaylistItems(token,playlist.id);const readbackVideos=new Set(readback.map(item=>item.video_id));for(const item of manifest.additions)if(!readbackVideos.has(item.video_id))throw new Error(`YOUTUBE_ADD_READBACK_FAILED:${item.video_id}`);for(const item of manifest.removals)if(readback.some(row=>row.playlist_item_id===item.playlist_item_id))throw new Error(`YOUTUBE_REMOVE_READBACK_FAILED:${item.playlist_item_id}`);
  process.stdout.write(`${JSON.stringify({mode:'apply',manifest_hash:manifestHash,applied:{additions:appliedAdds,removals:manifest.removals},readback_count:readback.length},null,2)}\n`);
}

main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1});
