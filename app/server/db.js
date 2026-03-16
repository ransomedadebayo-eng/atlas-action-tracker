import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'tracker.db');

const db = new Database(DB_PATH);

// Enable WAL mode for concurrent access
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    full_name TEXT,
    email TEXT,
    businesses TEXT NOT NULL,
    role TEXT,
    aliases TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT,
    business TEXT,
    participants TEXT DEFAULT '[]',
    raw_text TEXT,
    summary TEXT,
    decisions TEXT DEFAULT '[]',
    open_questions TEXT DEFAULT '[]',
    action_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending'
      CHECK (status IN ('pending','reviewed','archived')),
    summary_file TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'not_started'
      CHECK (status IN ('not_started','in_progress','waiting','blocked','done')),
    business TEXT NOT NULL,
    priority TEXT DEFAULT 'p2'
      CHECK (priority IN ('p0','p1','p2','p3')),
    due_date TEXT,
    owners TEXT NOT NULL DEFAULT '[]',
    source_transcript_id TEXT REFERENCES transcripts(id),
    source_label TEXT,
    tags TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
  CREATE INDEX IF NOT EXISTS idx_actions_business ON actions(business);
  CREATE INDEX IF NOT EXISTS idx_actions_priority ON actions(priority);
  CREATE INDEX IF NOT EXISTS idx_actions_due_date ON actions(due_date);
`);

// Migration: add recurrence column
try {
  db.exec(`ALTER TABLE actions ADD COLUMN recurrence TEXT DEFAULT 'none' CHECK (recurrence IN ('none','daily','weekly','biweekly','monthly'))`);
  console.log('[db] Added recurrence column');
} catch (e) {
  // Column already exists — ignore
}

db.exec(`

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id TEXT REFERENCES actions(id),
    event TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    actor TEXT DEFAULT 'system',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS saved_views (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    filters TEXT NOT NULL DEFAULT '{}',
    sort_by TEXT DEFAULT 'priority',
    sort_dir TEXT DEFAULT 'asc',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed data function
function seedData() {
  const memberCount = db.prepare('SELECT COUNT(*) as count FROM members').get();
  if (memberCount.count > 0) return;

  console.log('[db] Seeding initial data...');

  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO members (id, name, full_name, email, businesses, role, aliases, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const members = [
    ['ransomed', 'Ransomed', 'Ransomed Adebayo', null, '["riddim_exchange","real_estate","investments","personal","fitness"]', 'Owner / Leader', '["ransom","rans"]', 1],
    ['ola', 'Ola', null, null, '["riddim_exchange"]', 'Music Director', '[]', 1],
    ['kolade', 'Kolade', null, null, '["riddim_exchange"]', 'Producer', '[]', 1],
    ['nicole', 'Nicole', null, null, '["personal","real_estate"]', 'Family / Co-investor', '[]', 1],
    ['edem', 'Edem', null, null, '["riddim_exchange"]', 'Sync Licensing Partner', '["adam"]', 1],
    ['claude', 'Claude', 'Claude (AI Assistant)', null, '["riddim_exchange","real_estate","investments","personal","fitness","learning_platform"]', 'AI Assistant', '["ai","assistant","bot"]', 1],
  ];

  const insertMembers = db.transaction(() => {
    for (const m of members) {
      insertMember.run(...m);
    }
  });
  insertMembers();

  // Seed businesses config
  const insertConfig = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  insertConfig.run('businesses', JSON.stringify([
    { id: 'riddim_exchange', name: 'Riddim Exchange', color: '#22c55e' },
    { id: 'real_estate', name: 'Real Estate', color: '#3b82f6' },
    { id: 'investments', name: 'Investments', color: '#a855f7' },
    { id: 'personal', name: 'Personal', color: '#f59e0b' },
    { id: 'fitness', name: 'Fitness', color: '#ef4444' },
  ]));

  // Seed 10 actions
  const insertAction = db.prepare(`
    INSERT OR IGNORE INTO actions (id, title, description, status, business, priority, due_date, owners, source_label, tags, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const actions = [
    [uuidv4(), 'Complete PRO registration for all songwriters', 'Register all Riddim Exchange songwriters with ASCAP/BMI for sync licensing royalties', 'in_progress', 'riddim_exchange', 'p1', '2026-03-27', '["ransomed"]', 'Edem sync call', '["sync","legal"]', ''],
    [uuidv4(), 'Send existing catalog to Edem for sync eval', 'Compile and send all existing tracks to Edem for sync licensing evaluation', 'not_started', 'riddim_exchange', 'p1', '2026-03-27', '["ransomed","ola"]', 'Edem sync call', '["sync","catalog"]', ''],
    [uuidv4(), 'Produce 3 demo tracks per Edem brief', 'Create 3 production-ready demo tracks following Edem sync brief requirements', 'not_started', 'riddim_exchange', 'p1', '2026-04-10', '["ola"]', 'Edem sync call', '["sync","production"]', ''],
    [uuidv4(), 'Research Tunefind and watch trailers', 'Study Tunefind platform and analyze current trailer music trends for sync opportunities', 'not_started', 'riddim_exchange', 'p2', null, '["ransomed","ola","kolade"]', 'Edem sync call', '["sync","research"]', ''],
    [uuidv4(), 'Review distributor sync opt-in/out terms', 'Check current distributor agreement for sync licensing terms and opt-in status', 'not_started', 'riddim_exchange', 'p1', '2026-03-27', '["ransomed"]', 'Edem sync call', '["sync","legal"]', ''],
    [uuidv4(), 'Design sync production music album', 'Plan and design a purpose-built production music album for sync licensing', 'not_started', 'riddim_exchange', 'p2', '2026-04-24', '["ola","ransomed"]', 'Edem sync call', '["sync","production"]', ''],
    [uuidv4(), 'Develop cover strategy (5-10 reimagined songs)', 'Identify and plan 5-10 cover songs to reimagine in Afrobeats/Highlife style for sync', 'not_started', 'riddim_exchange', 'p2', '2026-04-24', '["ola","ransomed"]', 'Edem sync call', '["sync","strategy"]', ''],
    [uuidv4(), 'Set up X Developer account for auto-posting', 'Create X/Twitter developer account and configure automated posting pipeline', 'not_started', 'riddim_exchange', 'p3', null, '["ransomed"]', 'Backlog', '["social","automation"]', ''],
    [uuidv4(), 'Weekly fitness check-in', 'Review Apple Health data and log weekly fitness progress', 'in_progress', 'fitness', 'p2', '2026-03-14', '["ransomed"]', 'Standing', '["health","recurring"]', ''],
    [uuidv4(), 'CPMAI certification progress', 'Continue working through CPMAI AI certification course modules', 'in_progress', 'personal', 'p2', '2026-04-30', '["ransomed"]', 'AI Strategy Plan', '["learning","ai"]', ''],
  ];

  const insertActions = db.transaction(() => {
    for (const a of actions) {
      insertAction.run(...a);
    }
    // Log creation activity for each action
    const logStmt = db.prepare(`
      INSERT INTO activity_log (action_id, event, new_value, actor)
      VALUES (?, 'created', ?, 'system')
    `);
    for (const a of actions) {
      logStmt.run(a[0], a[1]);
    }
  });
  insertActions();

  console.log('[db] Seed data inserted: 5 members, 5 businesses, 10 actions');
}

seedData();

export default db;
