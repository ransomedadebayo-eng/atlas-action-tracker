import copy,json,os
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse,parse_qs
from pathlib import Path
ROOT=str(Path(__file__).resolve().parents[2] / 'app' / 'dist')
EVENTS='/tmp/atlas-simplification-ui-requests.jsonl'
def action(id,title,status,business='atlas'):
 return dict(id=id,identifier='ATLAS-QA-'+id,title=title,status=status,business=business,priority='p2',owners=['codex'],tags=[],notes='Historical notes remain unchanged.',description='Local synthetic QA fixture.',evidence_json={},revision=1,created_at='2026-09-01T00:00:00Z',updated_at='2026-09-01T00:00:00Z',due_date=None,approval_state='not_required',work_mode='autonomous')
A=[action('open','Triage the release plan','open'),action('canceled','Canceled task retains status','canceled'),action('done','Verify the completed release','done'),action('active','Review the project contract','in_progress','personal')]
P=[dict(id='p1',name='Atlas simplification',summary='One project container, one weekly cadence.',business='atlas',status='in_progress',health='on_track',priority='p1',open_action_count=2,oldest_open_days=47,last_activity_at='2026-09-01T00:00:00Z',is_stale=True,progress={'progress_percent':33},members=['codex'],lead_id='codex',milestones=[],dependencies=[],actions=A,updates=[],activity=[]),dict(id='p2',name='Family plans',summary='Keep useful context together.',business='personal',status='paused',health='no_update',priority='p2',open_action_count=0,oldest_open_days=None,last_activity_at='2026-10-18T00:00:00Z',is_stale=False,progress={'progress_percent':0},members=['ransomed'],lead_id='ransomed',milestones=[],dependencies=[])]
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=ROOT,**kw)
 def log_message(self,*a):pass
 def send_json(self,obj,status=200):
  data=json.dumps(obj).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def record(self,body=None):
  with open(EVENTS,'a') as f:f.write(json.dumps(dict(method=self.command,path=self.path,body=body))+'\n')
 def do_GET(self):
  u=urlparse(self.path);p=u.path;q=parse_qs(u.query)
  if not p.startswith('/api/'):
   if p=='/' or not os.path.isfile(ROOT+p):self.path='/index.html'
   return super().do_GET()
  self.record()
  if p=='/api/config/businesses':return self.send_json([dict(id='atlas',name='Atlas',color='#3b82f6'),dict(id='personal',name='Personal',color='#a855f7')])
  if p=='/api/config/estimate-settings':return self.send_json(dict(enabled=False,unestimated_value=1))
  if p=='/api/members':return self.send_json([dict(id='ransomed',name='Ransomed',role='owner',type='human',active=True,color='#38bdf8'),dict(id='codex',name='Codex',type='agent',active=True,color='#a78bfa')])
  if p=='/api/projects':return self.send_json(dict(items=P,total=len(P),has_more=False))
  if p.startswith('/api/projects/'):return self.send_json(next((r for r in P if r['id']==p.split('/')[3]),P[0]))
  if p=='/api/actions/stats':return self.send_json(dict(total=4,by_status={'open':1,'canceled':1,'done':1,'in_progress':1},by_business={'atlas':3,'personal':1},by_priority={'p2':4}))
  if p=='/api/actions':
   rows=copy.deepcopy(A)
   if 'status' in q:rows=[r for r in rows if r['status'] in q['status'][0].split(',')]
   return self.send_json(dict(items=rows,total=len(rows),has_more=False))
  if p.startswith('/api/actions/'):
   a=next((r for r in A if r['id']==p.split('/')[3]),A[0])
   if p.endswith('/structure'):return self.send_json(dict(action=a,parent=None,children=[],relations=[],references=[],rollup={}))
   return self.send_json(a)
  if p=='/api/today':return self.send_json(dict(source='weekly_plan_guidance',items=[dict(id='today1',title=A[0]['title'],action=A[0]),dict(id='today2',title=A[3]['title'],action=A[3])]))
  if p.startswith('/api/weeks/'):
   start=p.rsplit('/',1)[-1];items=[dict(id='w1',kind='must_win',title=A[2]['title'],source_action_id='done',action=A[2]),dict(id='w2',kind='must_win',title=A[0]['title'],source_action_id='open',action=A[0]),dict(id='w3',kind='day_focus',title=A[2]['title'],plan_date=start,source_action_id='done',action=A[2]),dict(id='w4',kind='carryover',title=A[3]['title'],source_action_id='active',action=A[3])]
   pub=dict(id='week-qa',week_start=start,title='Local QA operating plan',summary='Synthetic plan validates the simplified weekly scorecard.',status='published',version=1,revision=1,items=items,commitments=[])
   return self.send_json(dict(week_start=start,published=pub,draft=None,selected_revision=None,history=[],days=[],diagnostics={'missing_actions':[],'stale_calendar':False}))
  if p.startswith('/api/comments'):return self.send_json(dict(threads=[],current_actor='codex',target_reactions=[],target_reacted_by_actor=[]))
  if p=='/api/views' or p.startswith('/api/activity/'):return self.send_json([])
  if p=='/api/notifications/unread-count':return self.send_json(dict(count=0))
  if p.startswith('/api/notifications'):return self.send_json(dict(items=[],total=0))
  return self.send_json([])
 def do_PUT(self):
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or b'{}');self.record(body)
  if self.path.startswith('/api/actions/'):
   a=next((r for r in A if r['id']==self.path.split('/')[3]),None)
   if a:a.update(body);a['revision']+=1;return self.send_json(a)
  return self.send_json(dict(error='Only synthetic action edits are supported'),405)
 def do_POST(self):self.send_json(dict(error='No external mutations in local QA'),405)
print('Local synthetic Atlas QA server at http://127.0.0.1:4187',flush=True)
ThreadingHTTPServer(('127.0.0.1',4187),Handler).serve_forever()
