import { DurableObject } from 'cloudflare:workers';
import { Env, getDb } from '../db';
import { changeSummary, mergeDocumentChanges, transformIndex } from '../utils/documentCollaboration';
import { parseDocumentRoomMessage, type DocumentSelection, type RoomAttachment } from '../utils/documentRoomProtocol';
import { sha256Hex } from '../utils/integrations';

type Row = Record<string, any>;

export class DocumentRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const documentId = request.headers.get('x-atlas-document-id') || '';
    if (request.headers.get('x-atlas-internal-action') === 'broadcast') {
      if (!documentId) return new Response('Document id required',{status:400});
      const payload=await request.json().catch(()=>null) as Row|null;
      if (!payload?.document) return new Response('Document snapshot required',{status:400});
      for(const socket of this.ctx.getWebSockets(`document:${documentId}`)){const attachment=this.attachment(socket);attachment.lastRevision=Number(payload.document.revision||attachment.lastRevision);socket.serializeAttachment(attachment);}
      this.broadcast(documentId,{type:'edit.external',protocol_version:1,document:payload.document,actor:payload.actor||'system',presence:this.presence(documentId)});
      return Response.json({broadcast:true,connections:this.ctx.getWebSockets(`document:${documentId}`).length});
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
    const actor = request.headers.get('x-atlas-actor') || '';
    const clientId = request.headers.get('x-atlas-client-id') || '';
    const canEdit = request.headers.get('x-atlas-can-edit') === 'true';
    if (!documentId || !['ransomed','codex','claude'].includes(actor) || !clientId || clientId.length > 128) return new Response('Invalid room identity', { status: 400 });
    const snapshot = await this.loadSnapshot(documentId);
    if (!snapshot) return new Response('Document not found', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: RoomAttachment = {
      documentId, actor, clientId, canEdit: canEdit && snapshot.document.status === 'active', selection: null,
      connectedAt: new Date().toISOString(), windowStartedAt: Date.now(), messageCount: 0, abuseCount: 0,
      lastRevision: Number(snapshot.document.revision || 0),
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [`document:${documentId}`, `actor:${actor}`]);
    this.safeSend(server, { type:'snapshot', protocol_version:1, ...snapshot, presence:this.presence(documentId) });
    this.broadcast(documentId, { type:'presence.joined', protocol_version:1, participant:this.publicAttachment(attachment), presence:this.presence(documentId) }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let attachment = this.attachment(ws);
    const rate = this.consumeRate(attachment);
    attachment = rate.attachment;
    ws.serializeAttachment(attachment);
    if (!rate.allowed) {
      this.safeSend(ws, { type:'error', code:'RATE_LIMITED', protocol_version:1 });
      if (rate.close) ws.close(1008, 'Repeated rate limit violations');
      return;
    }
    const parsed = parseDocumentRoomMessage(raw);
    if (!parsed.message) { this.safeSend(ws, { type:'error', code:parsed.error || 'MESSAGE_INVALID', protocol_version:1 }); return; }
    if (parsed.message.type === 'ping') { this.safeSend(ws, { type:'pong', request_id:parsed.message.request_id, protocol_version:1, server_time:new Date().toISOString() }); return; }
    if (parsed.message.type === 'presence') {
      attachment.selection = parsed.message.selection;
      if (parsed.message.revision !== undefined) attachment.lastRevision = parsed.message.revision;
      ws.serializeAttachment(attachment);
      this.broadcast(attachment.documentId, { type:'presence.updated', protocol_version:1, participant:this.publicAttachment(attachment), presence:this.presence(attachment.documentId) }, ws);
      return;
    }
    if (!attachment.canEdit) { this.safeSend(ws, { type:'error', code:'DOCUMENT_WRITE_SCOPE_REQUIRED', protocol_version:1 }); return; }
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.applyEdit(ws, attachment, parsed.message as Extract<typeof parsed.message, { type:'edit' }>);
    });
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    const attachment = this.attachment(ws);
    this.broadcast(attachment.documentId, { type:'presence.left', protocol_version:1, client_id:attachment.clientId, actor:attachment.actor, code, reason:reason.slice(0,120), presence:this.presence(attachment.documentId) }, ws);
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    const attachment = this.attachment(ws);
    console.error(`[document-room] ${attachment.documentId}/${attachment.clientId}: ${error instanceof Error ? error.message : String(error)}`);
  }

  private async applyEdit(ws: WebSocket, attachment: RoomAttachment, message: { operation_id:string;base_revision:number;base_content_sha256:string;title:string;content:string;selection:DocumentSelection|null }) {
    const supabase = getDb(this.env);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const currentResult = await supabase.from('atlas_documents').select('*').eq('id', attachment.documentId).maybeSingle();
      if (currentResult.error) { this.safeSend(ws,{type:'error',code:'DOCUMENT_LOAD_FAILED',protocol_version:1}); return; }
      const current = currentResult.data as Row | null;
      if (!current) { this.safeSend(ws,{type:'error',code:'DOCUMENT_NOT_FOUND',protocol_version:1}); return; }
      if (current.status === 'archived') { attachment.canEdit=false; ws.serializeAttachment(attachment); this.safeSend(ws,{type:'error',code:'DOCUMENT_ARCHIVED',protocol_version:1}); return; }
      if (message.base_revision > Number(current.revision)) { this.safeSend(ws,{type:'error',code:'BASE_REVISION_AHEAD',protocol_version:1,current_revision:current.revision}); return; }
      const baseResult = await supabase.from('atlas_document_versions').select('*').eq('document_id',attachment.documentId).eq('revision',message.base_revision).maybeSingle();
      if (baseResult.error) { this.safeSend(ws,{type:'error',code:'BASE_VERSION_LOAD_FAILED',protocol_version:1}); return; }
      const proposedHash = await sha256Hex(message.content);
      const currentHash = await sha256Hex(String(current.content || ''));
      if (!baseResult.data) { await this.recordConflict(attachment,message,current,'base_version_missing',message.base_content_sha256,proposedHash,currentHash); this.safeSend(ws,{type:'edit.conflict',protocol_version:1,reason:'base_version_missing',operation_id:message.operation_id,document:current}); return; }
      const base = baseResult.data as Row;
      const baseHash = await sha256Hex(String(base.content || ''));
      if (baseHash !== message.base_content_sha256) { await this.recordConflict(attachment,message,current,'base_hash_mismatch',baseHash,proposedHash,currentHash); this.safeSend(ws,{type:'edit.conflict',protocol_version:1,reason:'base_hash_mismatch',operation_id:message.operation_id,document:current}); return; }
      const merged = mergeDocumentChanges({ baseTitle:String(base.title||''),baseContent:String(base.content||''),currentTitle:String(current.title||''),currentContent:String(current.content||''),proposedTitle:message.title,proposedContent:message.content });
      if (!merged.ok || merged.title === undefined || merged.content === undefined || !merged.strategy) {
        const reason = merged.reason || 'overlapping_change';
        await this.recordConflict(attachment,message,current,reason,baseHash,proposedHash,currentHash);
        this.safeSend(ws,{type:'edit.conflict',protocol_version:1,reason,operation_id:message.operation_id,document:current}); return;
      }
      let selection = message.selection;
      if (selection && message.base_revision !== Number(current.revision)) {
        selection = { start:transformIndex(selection.start,merged.currentChange),end:transformIndex(selection.end,merged.currentChange) };
        selection.end=Math.min(selection.end,merged.content.length);selection.start=Math.min(selection.start,selection.end);
      }
      const resultHash = await sha256Hex(merged.content);
      const rpc = await supabase.rpc('apply_atlas_document_realtime_edit', {
        p_document_id:attachment.documentId,p_client_id:attachment.clientId,p_operation_id:message.operation_id,
        p_base_revision:message.base_revision,p_expected_revision:current.revision,p_title:merged.title,p_content:merged.content,
        p_base_content_sha256:baseHash,p_result_content_sha256:resultHash,p_merge_strategy:merged.strategy,
        p_change_summary:changeSummary(merged.proposedChange),p_selection:selection,p_actor:attachment.actor,
      });
      if (rpc.error) {
        if ((rpc.error.code==='40001'||rpc.error.message?.includes('REVISION_CONFLICT'))&&attempt===0) continue;
        const reason='retry_exhausted';await this.recordConflict(attachment,message,current,reason,baseHash,proposedHash,currentHash);
        this.safeSend(ws,{type:'edit.conflict',protocol_version:1,reason,operation_id:message.operation_id,document:current});return;
      }
      const confirmed=rpc.data?.document || rpc.data;
      attachment.selection=selection;attachment.lastRevision=Number(confirmed.revision||current.revision+1);ws.serializeAttachment(attachment);
      this.broadcast(attachment.documentId,{type:'edit.applied',protocol_version:1,operation_id:message.operation_id,document:confirmed,operation:rpc.data?.operation||null,replay:Boolean(rpc.data?.replay),actor:attachment.actor,client_id:attachment.clientId,presence:this.presence(attachment.documentId)});
      return;
    }
  }

  private async recordConflict(attachment:RoomAttachment,message:{operation_id:string;base_revision:number;selection:DocumentSelection|null},current:Row,reason:string,baseHash:string,proposedHash:string,currentHash:string){
    await getDb(this.env).rpc('record_atlas_document_conflict',{p_document_id:attachment.documentId,p_client_id:attachment.clientId,p_operation_id:message.operation_id,p_base_revision:message.base_revision,p_current_revision:current.revision,p_base_content_sha256:baseHash,p_proposed_content_sha256:proposedHash,p_current_content_sha256:currentHash,p_reason:reason,p_selection:message.selection,p_actor:attachment.actor});
  }

  private async loadSnapshot(documentId:string){
    const supabase=getDb(this.env);const[document,operations,conflicts]=await Promise.all([
      supabase.from('atlas_documents').select('*').eq('id',documentId).maybeSingle(),
      supabase.from('atlas_document_operations').select('*').eq('document_id',documentId).order('applied_revision',{ascending:false}).limit(50),
      supabase.from('atlas_document_conflicts').select('*').eq('document_id',documentId).order('created_at',{ascending:false}).limit(20),
    ]);if(document.error||!document.data)return null;return{document:document.data,operations:operations.data||[],conflicts:conflicts.data||[]};
  }
  private consumeRate(attachment:RoomAttachment){const now=Date.now();const next={...attachment};if(now-next.windowStartedAt>=1000){next.windowStartedAt=now;next.messageCount=0;}next.messageCount+=1;const allowed=next.messageCount<=20;if(!allowed)next.abuseCount+=1;return{allowed,close:next.abuseCount>=3,attachment:next};}
  private attachment(ws:WebSocket):RoomAttachment{return ws.deserializeAttachment() as RoomAttachment;}
  private publicAttachment(value:RoomAttachment){return{actor:value.actor,client_id:value.clientId,can_edit:value.canEdit,selection:value.selection,connected_at:value.connectedAt,last_revision:value.lastRevision};}
  private presence(documentId:string){return this.ctx.getWebSockets(`document:${documentId}`).map(socket=>this.publicAttachment(this.attachment(socket)));}
  private safeSend(ws:WebSocket,value:unknown){try{ws.send(JSON.stringify(value));}catch{/* disconnected */}}
  private broadcast(documentId:string,value:unknown,exclude?:WebSocket){const body=JSON.stringify(value);for(const socket of this.ctx.getWebSockets(`document:${documentId}`)){if(socket!==exclude)try{socket.send(body);}catch{/* disconnected */}}}
}
