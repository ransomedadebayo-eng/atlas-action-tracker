import { useCallback, useEffect, useRef, useState } from 'react'
import { documentsApi } from '../api/client.js'

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}
function clientId() {
  const key = 'atlas_document_client_id'; let value = localStorage.getItem(key)
  if (!value) { value = `browser:${crypto.randomUUID()}`; localStorage.setItem(key, value) }
  return value
}
function draftKey(documentId) { return `atlas_document_draft:${documentId}` }
function websocketUrl(documentId, id) { const url = new URL(`/api/documents/${encodeURIComponent(documentId)}/realtime`, window.location.origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('client_id', id); return url.toString() }

export function useDocumentRealtime(documentId, initialDocument) {
  const idRef = useRef(null); if (!idRef.current && typeof window !== 'undefined') idRef.current = clientId()
  const socketRef = useRef(null); const reconnectRef = useRef(null); const reconnectAttemptRef = useRef(0); const mountedRef = useRef(true)
  const canonicalRef = useRef(initialDocument || null); const draftRef = useRef(null); const dirtyRef = useRef(false); const inFlightRef = useRef(null); const selectionRef = useRef(null); const conflictRef = useRef(null)
  const [document, setDocument] = useState(initialDocument || null); const [draft, setDraft] = useState(initialDocument ? { title:initialDocument.title||'',content:initialDocument.content||'' } : null)
  const [syncState, setSyncState] = useState('connecting'); const [presence, setPresence] = useState([]); const [conflict, setConflict] = useState(null); const [operations, setOperations] = useState(initialDocument?.operations || []); const [conflicts, setConflicts] = useState(initialDocument?.conflicts || []); const [error, setError] = useState('')

  const applyCanonical = useCallback((next, allowDraftReset = true) => {
    if (!next) return; canonicalRef.current = next; setDocument(next)
    if (allowDraftReset && !dirtyRef.current && !inFlightRef.current) { const value={title:next.title||'',content:next.content||''};draftRef.current=value;setDraft(value);localStorage.removeItem(draftKey(documentId)) }
  }, [documentId])

  const flush = useCallback(async (allowFallback = false) => {
    const canonical=canonicalRef.current;const currentDraft=draftRef.current;if(!canonical||!currentDraft||!dirtyRef.current||inFlightRef.current||conflictRef.current)return false
    const socket=socketRef.current;const operationId=crypto.randomUUID();const payload={type:'edit',operation_id:operationId,base_revision:canonical.revision,base_content_sha256:await sha256Hex(canonical.content||''),title:currentDraft.title,content:currentDraft.content,selection:selectionRef.current}
    if(socket?.readyState===1){inFlightRef.current={operationId,draft:{...currentDraft}};dirtyRef.current=false;setSyncState('saving');socket.send(JSON.stringify(payload));return true}
    if(!allowFallback){setSyncState('offline');return false}
    try{setSyncState('saving');const saved=await documentsApi.update(documentId,{expected_revision:canonical.revision,client_id:idRef.current,operation_id:operationId,title:currentDraft.title,content:currentDraft.content});inFlightRef.current=null;dirtyRef.current=false;applyCanonical(saved,true);setSyncState('synced');return true}catch(caught){dirtyRef.current=true;setSyncState('offline');setError(caught.message||'Fallback save failed.');return false}
  }, [applyCanonical, documentId])

  const handleMessage = useCallback(event => {
    let message;try{message=JSON.parse(event.data)}catch{return}
    if(message.presence)setPresence(message.presence)
    if(message.type==='snapshot'){
      applyCanonical(message.document,false);setOperations(message.operations||[]);setConflicts(message.conflicts||[]);setSyncState('connected');reconnectAttemptRef.current=0
      let local=null;try{local=JSON.parse(localStorage.getItem(draftKey(documentId))||'null')}catch{}
      if(local&&typeof local.title==='string'&&typeof local.content==='string'&&(local.title!==message.document.title||local.content!==message.document.content)){draftRef.current={title:local.title,content:local.content};setDraft(draftRef.current);dirtyRef.current=false;const next={reason:'unsynced_local_draft',document:message.document,draft:draftRef.current};conflictRef.current=next;setConflict(next)}
      else{draftRef.current={title:message.document.title||'',content:message.document.content||''};setDraft(draftRef.current)}
    }else if(message.type==='edit.applied'||message.type==='edit.external'){
      const ours=message.operation_id&&inFlightRef.current?.operationId===message.operation_id;const sent=inFlightRef.current?.draft;if(ours)inFlightRef.current=null;applyCanonical(message.document,false)
      if(message.operation)setOperations(current=>[message.operation,...current.filter(item=>item.id!==message.operation.id)].slice(0,100))
      if(ours&&sent&&draftRef.current?.title===sent.title&&draftRef.current?.content===sent.content){dirtyRef.current=false;localStorage.removeItem(draftKey(documentId));setSyncState('synced')}
      else if(!dirtyRef.current&&!inFlightRef.current){draftRef.current={title:message.document.title||'',content:message.document.content||''};setDraft(draftRef.current);setSyncState('synced')}
      else if(ours){dirtyRef.current=true;setSyncState('unsaved');setTimeout(()=>flush(false),0)}
    }else if(message.type==='edit.conflict'){
      inFlightRef.current=null;dirtyRef.current=false;applyCanonical(message.document,false);const next={reason:message.reason,operation_id:message.operation_id,document:message.document,draft:draftRef.current};conflictRef.current=next;setConflict(next);setConflicts(current=>[next,...current].slice(0,50));setSyncState('conflict')
    }else if(message.type==='error'){setError(message.code||'Realtime document error');if(message.code==='DOCUMENT_ARCHIVED')setSyncState('read_only')}
  }, [applyCanonical, documentId, flush])

  useEffect(() => { if (initialDocument && !canonicalRef.current) { canonicalRef.current=initialDocument;setDocument(initialDocument);const value={title:initialDocument.title||'',content:initialDocument.content||''};draftRef.current=value;setDraft(value) } }, [initialDocument])

  useEffect(() => {
    mountedRef.current=true
    function connect(){if(!mountedRef.current||!documentId)return;const existing=socketRef.current;if(existing&&[0,1].includes(existing.readyState))return;setSyncState(reconnectAttemptRef.current?'reconnecting':'connecting');const socket=new WebSocket(websocketUrl(documentId,idRef.current));socketRef.current=socket;socket.onopen=()=>{setSyncState('connected');setError('')};socket.onmessage=handleMessage;socket.onerror=()=>setError('Realtime connection error.');socket.onclose=()=>{if(!mountedRef.current)return;setSyncState('offline');const delay=Math.min(1000*2**reconnectAttemptRef.current,30000);reconnectAttemptRef.current+=1;reconnectRef.current=setTimeout(connect,delay)}}
    connect();return()=>{mountedRef.current=false;if(reconnectRef.current)clearTimeout(reconnectRef.current);socketRef.current?.close(1000,'Document closed')}
  }, [documentId, handleMessage])

  useEffect(() => { if(!dirtyRef.current||conflict)return;const timer=setTimeout(()=>flush(false),650);return()=>clearTimeout(timer) }, [draft, conflict, flush])

  const updateDraft = useCallback((next, selection = selectionRef.current) => { const value=typeof next==='function'?next(draftRef.current):next;draftRef.current=value;selectionRef.current=selection;dirtyRef.current=true;setDraft(value);conflictRef.current=null;setConflict(null);setSyncState(socketRef.current?.readyState===1?'unsaved':'offline');localStorage.setItem(draftKey(documentId),JSON.stringify({...value,base_revision:canonicalRef.current?.revision??0,updated_at:new Date().toISOString()})) }, [documentId])
  const updatePresence = useCallback(selection => { selectionRef.current=selection;const socket=socketRef.current;if(socket?.readyState===1)socket.send(JSON.stringify({type:'presence',selection,revision:canonicalRef.current?.revision??0})) }, [])
  const useLatest = useCallback(() => { const latest=canonicalRef.current;if(!latest)return;const value={title:latest.title||'',content:latest.content||''};draftRef.current=value;setDraft(value);dirtyRef.current=false;inFlightRef.current=null;conflictRef.current=null;setConflict(null);localStorage.removeItem(draftKey(documentId));setSyncState(socketRef.current?.readyState===1?'synced':'offline') }, [documentId])
  const retryDraft = useCallback(() => { conflictRef.current=null;setConflict(null);dirtyRef.current=true;setSyncState('unsaved');setTimeout(()=>flush(false),0) }, [flush])

  return { clientId:idRef.current,document,draft,syncState,presence,conflict,operations,conflicts,error,updateDraft,updatePresence,flush,useLatest,retryDraft }
}
