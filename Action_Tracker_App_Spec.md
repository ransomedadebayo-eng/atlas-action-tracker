# ATLAS Action Tracker — Local App Spec

**For the agent building this:** You are building a multi-surface system with 4 consumers sharing one SQLite database. Read the "System Architecture" section before writing any code — it explains how the web app, menu bar widget, Claude (via Desktop Commander), and Claude Code (via skill) all interact through `~/action-tracker/tracker.db`. The SQLite schema is defined in `~/.claude/skills/transcript-parser/references/data-schemas.md` — read that file before implementing any database logic.

## Overview

A self-hosted, local-first action tracker with 4 access surfaces:

1. **Web app** (React + Express) — full UI for managing actions, team, transcripts
2. **macOS menu bar widget** (Swift or Electron) — always-on, shows next 5 actions + overdue badge
3. **Claude via Desktop Commander** (Claude.ai conversations) — parses transcripts, queries tracker, updates actions through natural conversation
4. **Claude Code** (transcript-parser skill) — same parsing intelligence from the terminal

All 4 surfaces read and write the same SQLite database at `~/action-tracker/tracker.db` (WAL mode for safe concurrent access). The transcript-parser Claude skill is already installed at `~/.claude/skills/transcript-parser/` and the database is initialized with 5 businesses and 17 team members.

---

## Why Local vs. Notion/SaaS

| Factor | Local App | Notion/SaaS |
|--------|-----------|-------------|
| Claude can edit code & data directly | ✅ Yes, via Desktop Commander | ❌ Limited to MCP view tools |
| Data ownership | ✅ 100% on your machine | ⚠️ Third-party servers |
| Offline access | ✅ Always available | ❌ Requires internet |
| Custom features | ✅ Unlimited — I build what you need | ⚠️ Constrained by platform |
| Cost | ✅ Free forever | ⚠️ Subscription tiers |
| Update cycle | ✅ Instant — just ask me | ⚠️ Feature requests to vendor |

---

## Tech Stack

| Layer | Technology | Why |
|-------|------------|-----|
| Frontend | React 18 + Vite | Fast dev, hot reload, component-based |
| Styling | Tailwind CSS | Utility-first, rapid iteration, no CSS files to manage |
| Backend | Node.js + Express | Lightweight API server, runs anywhere |
| Database | SQLite via better-sqlite3 (WAL mode) | ACID-compliant, crash-safe, single-file, shared across all 4 consumers |
| AI Layer | Claude (Desktop Commander / Claude Code) | YOU are the parser — no API key needed |
| State | React Query (TanStack Query) | Server state sync, caching, optimistic updates |
| Menu Bar | SwiftUI + GRDB.swift | Native macOS, ~5MB, reads same SQLite file via GRDB |
| Icons | Lucide React | Clean, consistent icon set |
| Runtime | Node.js 18+ | Already on your Mac |

### Why SQLite Over JSON Flat Files (Research-Backed)

The original spec used JSON flat files. Industry research and local-first architecture best practices strongly recommend SQLite instead:

| Factor | JSON Flat Files | SQLite (WAL Mode) |
|--------|----------------|-------------------|
| Atomic writes | Manual (write-to-temp, rename). Crash mid-write = data loss | Native transactions. Crash-safe by default |
| Concurrent readers | File locking issues when 4 consumers access simultaneously | WAL mode allows unlimited concurrent reads + one writer |
| Query performance | Read entire file, filter in-memory. Degrades past ~1MB | Indexed queries. Handles 100MB+ efficiently |
| Data integrity | No constraints. Bad data silently accepted | Schema constraints, foreign keys, type checking |
| Reactivity / file watching | chokidar watches file changes but fires on every write | Same file-watch approach works, plus GRDB.swift has native observation |
| Claude CLI access | `python3` → `json.load` → filter → `json.dump` | `sqlite3 tracker.db "SELECT * FROM actions WHERE status != 'done'"` — simpler, faster |
| Migration path | Manual schema versioning | Built-in `user_version` pragma + migration scripts |

**Key config:** Always enable WAL mode (`PRAGMA journal_mode=WAL;`) on first connection. This allows the web app, menu bar widget, and Claude to read simultaneously without blocking each other.

**Single file:** All data lives in `~/action-tracker/tracker.db`. One file to back up, one file all consumers share.

### Competitive Landscape

Researched competitors in the meeting-to-actions space. None combine all our capabilities:

| Product | Approach | What They Lack |
|---------|----------|---------------|
| Hyprnote/Char | Local-first AI meeting notes, open source, SQLite storage | No multi-business tracking, no action tracker, no menu bar widget |
| Meetily | Privacy-first transcription + summarization | No task management, no CLI integration, cloud-optional |
| MeetGeek | Cloud-based conversation intelligence + analytics | Not local-first, no privacy, no multi-business |
| Fathom | One-tap recording with summaries + action items | Mobile-only, cloud-based, no custom business context |
| iWeaver | AI meeting action tracker with Zoom/Teams integration | Cloud-based, no local storage, no CLI/AI-assistant integration |

**Our unique position:** Local-first + multi-business team tracking + Claude as the intelligence layer (no API cost) + macOS menu bar widget + multi-consumer architecture (web app + menu bar + Claude chat + Claude Code all share one SQLite file). No competitor does this.

**Single command to start:** `npm run dev` → serves frontend on `:5173`, API on `:3001`

---

## System Architecture — How It All Works Together

**Read this section first.** It explains how every component in this system interacts. You are building a multi-surface application where 4 consumers share one data layer.

### The System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DATA LAYER (Source of Truth)                      │
│              ~/action-tracker/tracker.db  (SQLite, WAL mode)        │
│                                                                     │
│  Tables: actions | members | config | transcripts | activity_log    │
│  PRAGMA journal_mode=WAL  →  concurrent reads safe                  │
│                                                                     │
└────────┬──────────────┬──────────────────┬──────────────┬───────────┘
         │              │                  │              │
    ┌────▼────┐   ┌────▼───────┐   ┌─────▼────────┐ ┌──▼──────────────┐
    │ WEB APP │   │ MENU BAR   │   │ CLAUDE       │ │ CLAUDE CODE     │
    │ React + │   │ WIDGET     │   │ (chat/DC)    │ │ (skill)         │
    │ Express │   │ SwiftUI +  │   │              │ │                 │
    │         │   │ GRDB.swift │   │ Parses       │ │ Same parsing    │
    │ Full UI │   │            │   │ transcripts, │ │ skill, same     │
    │ CRUD,   │   │ Shows      │   │ queries,     │ │ SQLite file,    │
    │ kanban, │   │ next 5     │   │ updates      │ │ used from       │
    │ calendar│   │ actions    │   │ via sqlite3  │ │ terminal        │
    │ filters │   │ overdue    │   │ CLI or       │ │                 │
    │         │   │ badge      │   │ python3      │ │                 │
    └─────────┘   └────────────┘   └──────────────┘ └─────────────────┘
    better-sqlite3  GRDB.swift      sqlite3 CLI       sqlite3 CLI
    (Node.js)       (native Swift)  (shell)           (shell)
    localhost        macOS tray      Claude.ai +       Claude Code CLI
    :5173/:3001     always-on       Desktop Cmdr      on-demand
```

### The 4 Consumers — What Each Does

**1. Web App (React + Express) — what you're building**
The primary UI. Users interact with actions through the browser: create, edit, filter, view kanban boards, calendar, team workload. The Express API uses `better-sqlite3` for synchronous, high-performance SQLite access. React Query keeps the UI fresh.

- **Reads from:** tracker.db (actions, members, config, transcripts tables)
- **Writes to:** tracker.db (CRUD operations wrapped in transactions)
- **Connection:** `better-sqlite3` with WAL mode enabled on first connection
- **Serves on:** `http://localhost:5173` (frontend), `http://localhost:3001` (API)

**2. macOS Menu Bar Widget — persistent glanceable status**
A lightweight always-on widget in the macOS menu bar. Shows the next 5 actions sorted by urgency, a badge for overdue count, and quick actions (mark done, open tracker). Uses **GRDB.swift** to read the same SQLite file with native observation support.

- **Reads from:** tracker.db via GRDB.swift (Swift-native SQLite wrapper with built-in change observation)
- **Writes to:** tracker.db (only for quick actions: mark done, snooze)
- **Change detection:** GRDB's `DatabaseRegionObservation` detects writes from any consumer automatically + `DispatchSource.makeFileSystemObjectSource` as fallback for external changes
- **Runs as:** macOS login item (`LSUIElement=1`), always visible in menu bar

**3. Claude via Desktop Commander (Claude.ai conversations)**
The intelligence layer. In any Claude.ai conversation, the user can paste a transcript, ask about overdue items, reassign tasks, run weekly digests, etc. Claude reads/writes the SQLite file directly via `sqlite3` CLI commands.

- **Reads from:** `sqlite3 ~/action-tracker/tracker.db "SELECT ..."`
- **Writes to:** `sqlite3 ~/action-tracker/tracker.db "INSERT/UPDATE ..."` (WAL mode makes this safe even while app is running)
- **Parsing workflow:** User pastes transcript → Claude extracts actions → presents table for review → user confirms → Claude writes via sqlite3 CLI
- **Management workflow:** "What's overdue?" → Claude runs SQL query, presents results

**4. Claude Code (transcript-parser skill)**
Same parsing intelligence, accessed from the terminal via Claude Code CLI. Uses the `transcript-parser` skill installed at `~/.claude/skills/transcript-parser/`. Same SQLite file, same `sqlite3` CLI access.

- **Reads from:** Same tracker.db, same SQL queries
- **Writes to:** Same tracker.db via `sqlite3` CLI or Python `sqlite3` module
- **Skill location:** `~/.claude/skills/transcript-parser/SKILL.md`

### Critical: The SQLite File Is the API

There is no database server. No REST API between consumers (except the web app's internal Express API which queries the same SQLite file). The `tracker.db` file IS the shared state. This means:

1. **Any consumer can read at any time** — WAL mode allows unlimited concurrent readers. The web app, menu bar, and Claude can all query simultaneously.
2. **One writer at a time** — SQLite serializes writes automatically. With WAL mode, writes don't block readers. Short write transactions (INSERT/UPDATE) complete in <1ms.
3. **The web app should re-read on focus** — when the browser tab regains focus, re-fetch data from the Express API (which re-queries SQLite) to pick up changes made by Claude or the menu bar widget. Use `document.visibilityState` change event.
4. **The menu bar widget uses GRDB observation** — GRDB.swift has built-in `DatabaseRegionObservation` that detects when any process writes to the SQLite file. Falls back to `DispatchSource` file watching for non-GRDB writers.
5. **WAL mode is mandatory** — Set `PRAGMA journal_mode=WAL;` on every first connection from every consumer. This is what makes multi-consumer safe. Without it, readers block writers.
6. **Claude uses sqlite3 CLI** — Direct SQL queries. No ORM, no driver installation. Every Mac has sqlite3 built in.

### Data Flow Examples

**Example A: User parses a transcript via Claude chat**
```
1. User pastes transcript in Claude.ai conversation
2. Claude runs: sqlite3 ~/action-tracker/tracker.db "SELECT id, name, aliases FROM members"
3. Claude extracts 8 actions, presents for review in chat
4. User confirms: "commit all"
5. Claude runs: sqlite3 ~/action-tracker/tracker.db "BEGIN; INSERT INTO actions ...; INSERT INTO ...; COMMIT;"
6. Menu bar widget's GRDB observation detects DB change → re-queries → shows new top 5
7. User opens web app → Express re-queries tracker.db → UI shows all 8 new actions
```

**Example B: User marks an action done in the web app**
```
1. User clicks "Done" on an action in the React UI
2. React calls PUT /api/actions/:id with status: "done"
3. Express runs: db.prepare("UPDATE actions SET status='done', completed_at=? WHERE id=?").run(now, id)
4. Menu bar widget detects change → action disappears from top 5
5. Next Claude conversation: "What's overdue?" → Claude queries tracker.db → action is gone
```

**Example C: User creates an action via menu bar quick-add**
```
1. User clicks "Quick Add" in menu bar dropdown
2. Types: "Book studio for April 15" + selects Riddim Exchange + P1
3. SwiftUI writes via GRDB: try db.write { db in try Action(...).insert(db) }
4. Web app auto-refreshes on next focus → new action appears
5. Claude sees it next time it queries the DB
```

**Example D: User uploads a transcript in the web app for later parsing**
```
1. User drags a .txt file into the web app's transcript upload area
2. Express inserts transcript row with status='pending' and raw_text into transcripts table
3. Later, user tells Claude: "Any pending transcripts?"
4. Claude: sqlite3 tracker.db "SELECT id, title, date FROM transcripts WHERE status='pending'"
5. Claude reads raw_text, parses, presents actions, user confirms
6. Claude: sqlite3 tracker.db "BEGIN; INSERT INTO actions ...; UPDATE transcripts SET status='reviewed' ...; COMMIT;"
```

### What the Web App Must Implement

The Express API should provide these capabilities over the SQLite database:

| Feature | How it works |
|---------|-------------|
| Database connection | `const db = require('better-sqlite3')('~/action-tracker/tracker.db'); db.pragma('journal_mode = WAL');` |
| List actions with filters | Parameterized SQL queries with WHERE clauses (status, business, priority, owner, search text, date range) |
| Create/update/complete actions | Prepared statements wrapped in transactions for multi-table writes |
| List/add/edit team members | CRUD on members table |
| Upload pending transcripts | INSERT into transcripts with status='pending' + raw_text |
| View transcript history | SELECT from transcripts (exclude raw_text for list views via column selection) |
| Dashboard stats | `SELECT status, COUNT(*) FROM actions GROUP BY status` + overdue count + per-owner breakdown |
| Action detail with source | JOIN actions with transcripts on source_transcript_id for decisions/summary |
| Re-read on focus | Frontend refetches queries when `document.visibilityState` changes to "visible" — picks up changes from Claude or menu bar |

### What the Menu Bar Widget Must Implement

| Feature | How it works |
|---------|-------------|
| Database connection | GRDB.swift `DatabaseQueue(path: "~/action-tracker/tracker.db")` with WAL mode |
| Watch for changes | GRDB's `DatabaseRegionObservation` for automatic change detection + `DispatchSource.makeFileSystemObjectSource` fallback |
| Sort and display top 5 | SQL query: `SELECT * FROM actions WHERE status NOT IN ('done','blocked') ORDER BY CASE WHEN due_date < date('now') THEN 0 ELSE 1 END, priority, due_date LIMIT 5` |
| Overdue badge | `SELECT COUNT(*) FROM actions WHERE due_date < date('now') AND status NOT IN ('done','blocked')` → show as red badge |
| Quick mark done | `UPDATE actions SET status='done', completed_at=datetime('now') WHERE id=?` |
| Open in browser | Shell open `http://localhost:5173/action/:id` |
| Read config for colors | `SELECT * FROM config WHERE key='businesses'` → parse JSON for color mapping |
| Resolve owner names | `SELECT id, name FROM members` → cache locally, refresh on DB change |

### Database Schema

The full SQLite schema with CREATE TABLE statements, indexes, and seed data is defined in:
```
~/.claude/skills/transcript-parser/references/data-schemas.md
```

**The web app and menu bar widget MUST use the same schema.** Read that file before implementing any database logic. Key constraints:
- Action IDs are UUID v4 strings (TEXT PRIMARY KEY)
- `owners` is stored as JSON array in a TEXT column (e.g., `'["ransomed","ola"]'`). Parse with `json_each()` for queries.
- `business` must match a business `id` from the config table
- `priority` is "p0", "p1", "p2", or "p3"
- `status` is one of: "not_started", "in_progress", "waiting", "blocked", "done"
- Always enable WAL mode: `PRAGMA journal_mode=WAL;`
- Use transactions for multi-statement writes: `BEGIN; ... COMMIT;`

---

## Data Model

All data lives in a single SQLite file: `~/action-tracker/tracker.db`. Enable WAL mode on first connection. Full schema details in `~/.claude/skills/transcript-parser/references/data-schemas.md`.

### Schema Overview

```sql
-- Business config (key-value store for settings)
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL  -- JSON for complex values
);

-- Team members across all businesses
CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,           -- lowercase slug, e.g. "ransomed"
    name TEXT NOT NULL,            -- display name
    full_name TEXT,
    email TEXT,
    businesses TEXT NOT NULL,      -- JSON array: '["riddim_exchange","real_estate"]'
    role TEXT,
    aliases TEXT DEFAULT '[]',     -- JSON array for fuzzy transcript matching
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Core action items
CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,           -- UUID v4
    title TEXT NOT NULL,           -- verb-first, e.g. "Complete PRO registration"
    description TEXT,
    status TEXT DEFAULT 'not_started'
        CHECK (status IN ('not_started','in_progress','waiting','blocked','done')),
    business TEXT NOT NULL,        -- must match config businesses
    priority TEXT DEFAULT 'p2'
        CHECK (priority IN ('p0','p1','p2','p3')),
    due_date TEXT,                 -- ISO date YYYY-MM-DD or NULL
    owners TEXT NOT NULL DEFAULT '[]',  -- JSON array of member IDs
    source_transcript_id TEXT REFERENCES transcripts(id),
    source_label TEXT,             -- "Edem Sync Call - Mar 13"
    tags TEXT DEFAULT '[]',        -- JSON array
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT              -- set when status → done
);
CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_business ON actions(business);
CREATE INDEX IF NOT EXISTS idx_actions_priority ON actions(priority);
CREATE INDEX IF NOT EXISTS idx_actions_due_date ON actions(due_date);

-- Parsed transcript log
CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT,                     -- ISO date of meeting
    business TEXT,
    participants TEXT DEFAULT '[]', -- JSON array of member IDs
    raw_text TEXT,                 -- full transcript (removed after review to save space)
    summary TEXT,
    decisions TEXT DEFAULT '[]',   -- JSON array of decision strings
    open_questions TEXT DEFAULT '[]',
    action_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending','reviewed','archived')),
    summary_file TEXT,             -- path to generated summary markdown
    created_at TEXT DEFAULT (datetime('now'))
);

-- Activity log (audit trail)
CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id TEXT REFERENCES actions(id),
    event TEXT NOT NULL,           -- created, updated, status_changed, completed, parsed_from_transcript
    old_value TEXT,
    new_value TEXT,
    actor TEXT DEFAULT 'system',   -- member_id, "claude", or "system"
    created_at TEXT DEFAULT (datetime('now'))
);
```

Pre-seeded with 17 members (full Riddim Exchange roster + Nicole + Edem with aliases) and 5 businesses (Riddim Exchange, Real Estate, Investments, Personal, Fitness).

**JSON-in-SQLite pattern:** Fields like `owners`, `businesses`, `aliases`, `tags`, `decisions` store JSON arrays in TEXT columns. Query with SQLite's built-in `json_each()`:

```sql
-- Find all actions owned by 'ransomed'
SELECT * FROM actions WHERE EXISTS (
    SELECT 1 FROM json_each(owners) WHERE value = 'ransomed'
);

-- Count actions per owner
SELECT j.value AS owner, COUNT(*) FROM actions, json_each(owners) j
WHERE status != 'done' GROUP BY j.value;
```

---

## API Endpoints

### Actions
```
GET    /api/actions              List actions (query params: status, business, priority, owner_id, due_before, due_after, search, source_id)
POST   /api/actions              Create action (accepts owner_ids array)
GET    /api/actions/:id          Get single action (includes owners, source transcript link)
PUT    /api/actions/:id          Update action
DELETE /api/actions/:id          Soft delete (archive)
POST   /api/actions/bulk         Bulk create actions (for Claude/transcript parser to seed data)
PUT    /api/actions/bulk         Bulk update actions

GET    /api/actions/stats        Dashboard stats (counts by status, business, priority, overdue, by owner)
GET    /api/actions/by-owner/:id Actions assigned to a specific team member
```

### Transcripts (Storage Only — Claude Does the Parsing)
```
POST   /api/transcripts          Store raw transcript text (status: pending, awaiting Claude parse)
GET    /api/transcripts          List all transcripts
GET    /api/transcripts/:id      Get transcript with linked actions
PUT    /api/transcripts/:id      Update transcript metadata / status
```

### Team Members
```
GET    /api/members              List all team members (filter by business, is_active)
POST   /api/members              Add team member
GET    /api/members/:id          Get member with their action stats
PUT    /api/members/:id          Update member
GET    /api/members/:id/actions  All actions for a member across businesses
GET    /api/members/stats        Member workload overview (action counts by status per person)
```

### Views & Activity
```
GET    /api/views                List saved views
POST   /api/views                Create saved view
PUT    /api/views/:id            Update saved view
DELETE /api/views/:id            Delete saved view

GET    /api/activity/:action_id  Activity log for an action
```

---

## Transcript Parsing Engine — Claude IS the Parser

There is no separate AI service. Claude is the parser. The app is a UI + JSON data layer. All intelligence lives in Claude conversations (Desktop Commander or Claude Code). Zero incremental cost.

### How It Works

**Workflow A: In-Conversation Parsing (Primary — 90% of use)**
```
1. User pastes transcript into Claude chat (or uploads a file)
2. Claude runs: sqlite3 ~/action-tracker/tracker.db "SELECT id, name, aliases FROM members WHERE is_active=1"
3. Claude extracts actions, presents structured table for review
4. User reviews: "Looks good, drop #4, change #6 to P1"
5. Claude runs: sqlite3 ~/action-tracker/tracker.db "BEGIN; INSERT INTO actions ...; COMMIT;"
6. Menu bar widget's GRDB observation detects DB change → refreshes top 5
7. Web app shows new actions on next load/focus.
```

**Workflow B: App Upload → Claude Review (Secondary)**
```
1. User uploads transcript in the web app UI
2. Express INSERTs into transcripts table with status='pending' and raw_text
3. Next Claude conversation: "Parse my pending transcripts"
4. Claude: sqlite3 tracker.db "SELECT id, title, raw_text FROM transcripts WHERE status='pending'"
5. Claude parses, presents for review, user confirms
6. Claude: sqlite3 tracker.db "BEGIN; INSERT INTO actions ...; UPDATE transcripts SET status='reviewed' ...; COMMIT;"
```

### What Claude Does During Parsing

1. **Read team roster** — `sqlite3 ~/action-tracker/tracker.db "SELECT id, name, aliases FROM members WHERE is_active=1"`
2. **Identify participants** — Match transcript names against members (including aliases). Ask about unknowns.
3. **Extract actions** — Find commitments, implied tasks, and decisions
4. **Assign owners** — Map speakers to member IDs. Ask when ambiguous.
5. **Infer priority** — Based on urgency language, dependencies, context
6. **Detect business** — Tag each action with the right business entity from config table
7. **Suggest due dates** — From explicit mentions or inference
8. **Present for review** — Structured table in chat, all fields adjustable
9. **Write to database** — SQL transaction: INSERT actions + UPDATE transcripts in one COMMIT
10. **Log activity** — INSERT into activity_log with actor = "claude"

### Desktop Commander Commands Claude Uses

```bash
# Read team members for name matching
sqlite3 ~/action-tracker/tracker.db "SELECT id, name, aliases FROM members WHERE is_active=1"

# Read business definitions
sqlite3 ~/action-tracker/tracker.db "SELECT value FROM config WHERE key='businesses'"

# Check for pending transcripts
sqlite3 ~/action-tracker/tracker.db \
  "SELECT id, title, date FROM transcripts WHERE status='pending'"

# Read a pending transcript
sqlite3 ~/action-tracker/tracker.db \
  "SELECT raw_text FROM transcripts WHERE id='xxx'"

# Write confirmed actions (transaction for atomicity)
sqlite3 ~/action-tracker/tracker.db << 'SQL'
BEGIN;
INSERT INTO actions (id, title, description, status, business, priority, due_date,
  owners, source_transcript_id, source_label, tags)
VALUES ('uuid-here', 'Action title', 'Description', 'not_started', 'riddim_exchange',
  'p1', '2026-03-27', '["ransomed","ola"]', 't-abc', 'Edem Call - Mar 13', '["sync"]');
-- repeat for each action
UPDATE transcripts SET status='reviewed', action_count=8,
  summary='Executive summary text' WHERE id='t-abc';
COMMIT;
SQL

# Quick status check
sqlite3 -column -header ~/action-tracker/tracker.db \
  "SELECT business, status, COUNT(*) as count FROM actions GROUP BY business, status"

# Overdue actions
sqlite3 -column -header ~/action-tracker/tracker.db \
  "SELECT title, priority, due_date, owners FROM actions
   WHERE due_date < date('now') AND status NOT IN ('done','blocked')
   ORDER BY priority, due_date"

# Workload per owner
sqlite3 -column -header ~/action-tracker/tracker.db \
  "SELECT j.value as owner, COUNT(*) as active_actions
   FROM actions, json_each(owners) j
   WHERE status NOT IN ('done','blocked')
   GROUP BY j.value ORDER BY active_actions DESC"
```

### Beyond Transcripts — Claude as Ongoing Tracker Manager

Since Claude has direct file access, it's not just a parser — it's the tracker's brain:

- **"What's overdue?"** → `SELECT title, due_date, owners FROM actions WHERE due_date < date('now') AND status NOT IN ('done','blocked')`
- **"Reassign Ola's P1s to Kolade"** → `UPDATE actions SET owners=... WHERE priority='p1' AND EXISTS(SELECT 1 FROM json_each(owners) WHERE value='ola')`
- **"Add action: book studio, P1, assign Ola"** → `INSERT INTO actions (...) VALUES (...)`
- **"Mark everything from the Edem call as done"** → `UPDATE actions SET status='done', completed_at=datetime('now') WHERE source_transcript_id='t-abc'`
- **"Weekly digest"** → Query completed/overdue/upcoming/blocked counts from actions table
- **"Who's overloaded?"** → `SELECT j.value, COUNT(*) FROM actions, json_each(owners) j WHERE status NOT IN ('done','blocked') GROUP BY j.value`

---

## UI Screens & Components

### 1. Main Dashboard (default view)
- **Top bar:** App title, quick-add button, transcript upload button, global search, filter toggles
- **Stats strip:** 5 cards — total active, overdue, completed this week, blocked, pending review (from transcripts)
- **Tab navigation:** All | Riddim Exchange | Real Estate | Investments | Personal | Fitness
- **Action list:** Sortable table with inline status toggles, priority badges, and owner avatars
- **Quick-add:** Keyboard shortcut (Cmd+K) opens modal to create action fast

### 2. Kanban Board View
- Columns: Not Started → In Progress → Waiting → Done (Blocked shown as overlay tag)
- Drag-and-drop cards between columns
- Cards show: title, priority badge, business tag, due date, owner avatar(s)
- Toggle grouping: by Status (default), by Business, by Owner

### 3. Transcript Upload View (Simplified — Claude Parses Separately)
- **Upload area:** Drop zone for paste or file upload (.txt, .md)
- **Metadata bar:** Set meeting title, date, business entity, select participants from team members
- **Status:** "Saved — pending Claude parse" → links to transcript history
- **No in-app parsing UI** — parsing happens in Claude conversations with full interactive review
- This screen is just for capturing transcripts when you're not in a Claude conversation (e.g., someone sends you a meeting transcript and you want to save it for later parsing)

### 4. Team Members View (NEW)
- **Member list:** All team members across businesses with avatar, role, and business tags
- **Workload dashboard:** Per-member action counts by status (bar chart or heatmap)
  - Quickly spot who's overloaded vs. underutilized
- **Member detail:** Click a member to see all their actions filtered, with stats
- **Add member:** Quick form — name, email, businesses, role
- **Business filter:** Toggle to see only members for a specific business

### 5. Action Detail Panel
- Slide-out panel (right side) on click
- Full edit form: all fields editable inline
- **Owner selector:** Multi-select dropdown with team member search, shows avatars
- **Source link:** If parsed from a transcript, clickable link back to the transcript with the source quote highlighted
- Activity timeline at bottom showing status changes, edits, and who made them
- Notes section with markdown support

### 6. Calendar View
- Month view showing actions by due date
- Color-coded by business entity
- Owner filter: show only actions for specific team members
- Click date to quick-add action for that date

### 7. Quick Capture (Cmd+K)
- Spotlight-style modal
- Type title → auto-suggest business/priority based on keywords
- "@" to mention/assign team members
- Enter to create, Tab to cycle fields
- Supports natural language: "Call Edem about sync demos by Friday p1 riddim @ola @ransomed"

### 8. Transcript History View (NEW)
- List of all parsed transcripts with date, title, business, action count
- Status badges: Pending Review, Reviewed, Archived
- Click to re-open the review UI for any past transcript
- Search across all transcript text

---

## Design Direction

**Aesthetic:** Industrial-utilitarian meets modern dashboard. Dark theme default (easy on the eyes for evening use). Clean data density — show maximum useful info without clutter.

**Color system:**
- Background: `#0f1117` (near-black)
- Surface: `#1a1d27` (dark card)
- Border: `#2a2d3a`
- Text primary: `#e4e4e7`
- Text secondary: `#71717a`
- Accent: `#f59e0b` (amber — warm, distinctive, not generic blue)

**Business entity colors:**
- Riddim Exchange: `#22c55e` (green)
- Real Estate: `#3b82f6` (blue)
- Investments: `#a855f7` (purple)
- Personal: `#f59e0b` (amber)
- Fitness: `#ef4444` (red)

**Priority badges:**
- P0 Urgent: Red pulsing dot
- P1 High: Orange solid
- P2 Medium: Yellow subtle
- P3 Low: Gray muted

**Typography:** JetBrains Mono for data/stats, Plus Jakarta Sans for headings and body.

---

## File Structure

```
~/action-tracker/
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── server/
│   ├── index.js                  Express server entry
│   ├── db.js                     SQLite connection (better-sqlite3, WAL mode) + migrations
│   ├── routes/
│   │   ├── actions.js            CRUD routes
│   │   ├── transcripts.js        Store/retrieve transcripts (Claude writes actions directly)
│   │   ├── members.js            Team member CRUD + stats
│   │   ├── views.js              Saved views routes
│   │   └── activity.js           Activity log routes
│   └── middleware/
│       └── logger.js             Request logging
├── src/
│   ├── main.jsx                  React entry
│   ├── App.jsx                   Root component + routing
│   ├── index.css                 Tailwind imports + custom styles
│   ├── api/
│   │   └── client.js             API client (fetch wrapper)
│   ├── components/
│   │   ├── Layout.jsx            App shell (sidebar + main)
│   │   ├── TopBar.jsx            Search, filters, quick-add, transcript upload
│   │   ├── StatsStrip.jsx        Dashboard stat cards
│   │   ├── ActionTable.jsx       Sortable table view
│   │   ├── ActionCard.jsx        Kanban card component
│   │   ├── KanbanBoard.jsx       Drag-drop board
│   │   ├── CalendarView.jsx      Month calendar
│   │   ├── ActionDetail.jsx      Slide-out detail panel
│   │   ├── QuickCapture.jsx      Cmd+K modal with @mentions
│   │   ├── FilterBar.jsx         Active filter chips
│   │   ├── StatusBadge.jsx       Status/priority visual indicators
│   │   ├── OwnerAvatars.jsx      Multi-owner avatar display
│   │   ├── TranscriptUpload.jsx  Drop zone + paste area (stores in DB for Claude to parse later)
│   │   ├── TranscriptHistory.jsx List of all transcripts with status + linked actions count
│   │   ├── MemberList.jsx        Team member directory
│   │   ├── MemberDetail.jsx      Member actions + workload stats
│   │   ├── MemberSelector.jsx    Multi-select dropdown with search
│   │   └── WorkloadChart.jsx     Per-member workload visualization
│   ├── hooks/
│   │   ├── useActions.js         React Query hooks for actions
│   │   ├── useTranscripts.js     Transcript upload + history hooks
│   │   ├── useMembers.js         Team member hooks
│   │   ├── useViews.js           Saved views hooks
│   │   └── useKeyboard.js        Keyboard shortcut handler
│   └── utils/
│       ├── constants.js          Status, priority, business enums
│       ├── colors.js             Color mappings (business, priority, member)
│       ├── dateUtils.js          Date formatting helpers
│       └── memberUtils.js        Avatar generation, name formatting
├── data/
│   └── tracker.db                SQLite database (auto-created, WAL mode)
├── summaries/                    Generated meeting summary markdown files
└── README.md
```

---

## Claude Editability Contract

This is the key differentiator. The app is designed so I can modify it in future conversations:

### What Claude can do via Desktop Commander:
1. **Parse transcripts** — Read transcripts, extract actions, write results to JSON files
2. **Add/update/complete actions** — Full CRUD on the actions table via SQL
3. **Manage team members** — Add new people, update roles, reassign actions
4. **Run queries** — Overdue report, workload analysis, weekly digest, custom queries
5. **Add features** — Read existing code, create new components, wire them in
6. **Fix bugs** — Read error context, edit source files directly
7. **Change UI** — Edit React components, Tailwind classes, layout
8. **Modify schema** — Add columns, create migration scripts
9. **Add views** — Create new saved view configurations

### Design rules for editability:
- Every component in its own file (no mega-files)
- Constants/enums centralized in `utils/constants.js`
- Colors centralized in `utils/colors.js` and Tailwind config
- API client abstracted (one file to change endpoints)
- Database migrations versioned (can add columns without data loss)
- No build step required for server changes (just restart)

### How a future conversation works:
```
Ransomed: "Add a 'delegated' status and show delegation count on dashboard"
Claude:   1. DC:read_file → constants.js (see current statuses)
          2. DC:edit_block → add 'delegated' to status enum
          3. DC:edit_block → StatsStrip.jsx (add delegation card)
          4. DC:edit_block → KanbanBoard.jsx (add column)
          5. DC:edit_block → db.js (migration if needed)
          Done. Restart server.
```

### Transcript parsing from a Claude conversation:
```
Ransomed: [pastes meeting transcript] "Parse this into actions"
Claude:   1. DC:start_process → sqlite3 tracker.db "SELECT id, name, aliases FROM members"
          2. Claude reads transcript, extracts actions, presents table in chat
          3. Ransomed reviews: "Drop #4, change #6 to P1, commit the rest"
          4. DC:start_process → sqlite3 tracker.db "BEGIN; INSERT INTO actions ...; COMMIT;"
          Done. Actions live in tracker. $0 extra cost.
```

### Daily tracker management from conversation:
```
Ransomed: "What's overdue this week?"
Claude:   1. DC:start_process → sqlite3 tracker.db "SELECT title, due_date FROM actions WHERE due_date < date('now') AND status NOT IN ('done','blocked')"
          2. Present summary: "3 overdue — PRO registration (5 days), catalog send (3 days)..."
          3. Ransomed: "Mark PRO registration as done, push catalog to Friday"
          4. DC:start_process → sqlite3 tracker.db "UPDATE actions SET status='done' WHERE ...; UPDATE actions SET due_date='2026-03-21' WHERE ..."
          Done.
```

---

## macOS Menu Bar Widget

A persistent menu bar icon that shows your next 5 actions at a glance — no need to open the browser.

### Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Menu bar app | SwiftUI + GRDB.swift (recommended) or Electron | Native macOS, ~5MB, reads same SQLite file |
| Data source | Reads directly from `~/action-tracker/tracker.db` | Same database the app and Claude write to — single source of truth |
| Change detection | GRDB DatabaseRegionObservation + DispatchSource fallback | Auto-refreshes when any consumer writes to tracker.db |

Alternatively, for a lighter footprint: a **SwiftUI menu bar app** (~50 lines of Swift) that reads the JSON file. No Electron overhead. Claude Code can build either.

### Behavior

**Icon:** Small status indicator in the macOS menu bar. Shows a count badge of overdue items (red dot with number). If nothing is overdue, shows a neutral icon.

**Click → Dropdown popup** displaying:

```
┌─────────────────────────────────────────────┐
│  ATLAS Tracker               3 overdue  🔴  │
│─────────────────────────────────────────────│
│  🔴 P0  Produce 3 demo tracks     Apr 10   │
│         Ola · Riddim Exchange               │
│                                             │
│  🟠 P1  Complete PRO registration  Mar 27   │
│         Ransomed · Riddim Exchange          │
│                                             │
│  🟠 P1  Send catalog to Edem      Mar 27   │
│         Ransomed, Ola · Riddim Exchange     │
│                                             │
│  🟡 P2  Research Tunefind          Ongoing  │
│         All Members · Riddim Exchange       │
│                                             │
│  🟡 P2  Design sync album         Apr 24   │
│         Ola, Ransomed · Riddim Exchange     │
│─────────────────────────────────────────────│
│  ⌘ Open Tracker    ⌘ Quick Add              │
└─────────────────────────────────────────────┘
```

### Selection Logic — "Next 5"

The widget queries `tracker.db` and displays the top 5 items sorted by this priority:

1. **Overdue P0** (past due_date, highest priority first)
2. **Overdue P1-P3** (past due_date, then by priority)
3. **Due today**
4. **Due this week** (sorted by priority, then due_date)
5. **No due date but P0/P1** (urgent items without dates)
6. **Remaining by priority + due_date ascending**

Filter: only shows actions where `status` is `not_started`, `in_progress`, or `waiting`. Never shows `done` or `blocked`.

Owner filter (optional setting): can be set to show only actions where the current user is an owner, or show all actions across all owners.

### Each Row Shows

- **Priority badge** — colored dot (P0 red, P1 orange, P2 yellow, P3 gray)
- **Title** — truncated to ~40 chars if needed
- **Due date** — relative format: "Today", "Tomorrow", "Mar 27", "Overdue 3d"
- **Owner(s)** — first names, comma-separated
- **Business tag** — colored text matching the business entity color from config

### Interactions

| Action | Result |
|--------|--------|
| Click a row | Opens the action detail in the browser app (`localhost:5173/action/:id`) |
| Right-click a row | Context menu: Mark Done, Change Priority, Snooze 1 Day |
| "Open Tracker" button | Opens `http://localhost:5173` in default browser |
| "Quick Add" button | Opens a minimal input field in the popup to create a new action (title + business + priority, writes to tracker.db) |
| Hover on overdue badge | Tooltip showing count: "3 actions overdue" |

### Auto-Refresh

The widget watches `~/action-tracker/tracker.db` using GRDB's `DatabaseRegionObservation` (detects writes from any consumer) with `DispatchSource.makeFileSystemObjectSource` as fallback. When any consumer writes to the database, the widget re-queries and updates the display automatically.

### Launch at Login

The menu bar app registers as a macOS login item so it starts automatically. Configurable in the app's preferences.

### File Structure Addition

```
~/action-tracker/
├── menubar/                      Menu bar widget (separate from web app)
│   ├── package.json              Electron deps (or Package.swift for native)
│   ├── main.js                   Tray icon + window setup
│   ├── renderer/
│   │   ├── index.html            Popup UI
│   │   ├── styles.css            Dark theme matching the web app
│   │   └── app.js                Query tracker.db, sort, render top 5
│   └── assets/
│       ├── icon.png              Menu bar icon (16x16, 32x32 @2x)
│       └── icon-alert.png        Icon with overdue indicator
```

### Native Swift Alternative (Lighter)

If Electron feels too heavy for a menu bar widget, a native SwiftUI version is ~100 lines:

```swift
// Reads ~/action-tracker/tracker.db via GRDB.swift
// Uses MenuBarExtra for the menu bar icon
// GRDB DatabaseRegionObservation watches for changes
// SwiftUI popover for the dropdown
// ~5MB vs ~150MB for Electron
```

Claude Code can build either version. The Swift version is recommended for battery life and memory, but the Electron version is faster to prototype and matches the web app's tech stack.

---

## Build Phases

### Phase 1 — Foundation + Team Members
- Express server with better-sqlite3 connecting to ~/action-tracker/tracker.db (WAL mode)
- Full CRUD API for actions and team members using parameterized SQL
- Multi-owner support (owners array in each action object)
- React app shell with table view
- Quick-add modal with @mention team member selector
- Filter by business/status/priority/owner
- Pre-seed all Riddim Exchange members + Ransomed + Nicole

### Phase 2 — Transcript Storage + Claude Integration
- Transcript upload UI (paste + file drop) — stores to DB with status: pending
- Transcript history view (list all transcripts, status badges)
- Claude workflow documentation (README section on how to parse via conversation)
- Seed the Edem sync call transcript as the first entry
- Verify end-to-end: upload in app → Claude reads from DB → writes actions back

### Phase 3 — Views, Polish & Menu Bar Widget
- Kanban board with drag-drop
- Calendar view with owner filtering
- Saved views
- Keyboard shortcuts (Cmd+K, Cmd+T for transcript)
- Stats dashboard with workload per member
- Member detail pages
- **macOS menu bar widget** — SwiftUI + GRDB.swift reading tracker.db, shows next 5 items, overdue badge, quick actions

### Phase 4 — Power Features
- Natural language quick capture parsing
- Activity log + timeline with actor tracking
- Recurring actions
- Weekly digest (auto-generated summary of completed/overdue per person)
- Export to markdown/PDF (for sharing with band or partners)
- Workload balancing view (who has too much, who has capacity)

### Phase 5 — Integrations (Optional)
- Google Calendar sync (due dates → calendar events)
- Email/Slack notifications for assigned actions
- Claude auto-check-in (proactive status updates during conversations)
- Webhook endpoint for external transcript sources (Otter.ai, Fireflies, etc.)
- n8n integration for automated transcript ingestion

---

## Seed Data (Phase 1)

Pre-populate with current action items from the Edem sync call and other active workstreams. Owner references map to team_members table:

| Title | Business | Priority | Source | Owners |
|-------|----------|----------|--------|--------|
| Complete PRO registration for all songwriters | Riddim Exchange | P1 | Edem sync call | Ransomed, All Writers |
| Send existing catalog to Edem for sync eval | Riddim Exchange | P1 | Edem sync call | Ransomed, Ola |
| Produce 3 demo tracks per Edem's brief | Riddim Exchange | P1 | Edem sync call | Ola |
| Research Tunefind and watch trailers | Riddim Exchange | P2 | Edem sync call | All Members |
| Review distributor sync opt-in/out terms | Riddim Exchange | P1 | Edem sync call | Ransomed |
| Design sync production music album | Riddim Exchange | P2 | Edem sync call | Ola, Ransomed |
| Develop cover strategy (5-10 reimagined songs) | Riddim Exchange | P2 | Edem sync call | Ola, Ransomed |
| Set up X Developer account for auto-posting | Riddim Exchange | P3 | Backlog | Ransomed |
| Weekly fitness check-in (Apple Health) | Fitness | P2 | Standing | Ransomed |
| CPMAI certification progress | Personal | P2 | AI Strategy Plan | Ransomed |

---

## Example: Parsing the Edem Call End-to-End

```
Ransomed: [pastes the 33-min Edem sync licensing transcript] "Parse this"

Claude: [DC: sqlite3 ~/action-tracker/tracker.db "SELECT id, name, aliases FROM members WHERE is_active=1"]

        Participants matched: Ransomed ✓, Ola ✓
        Note: "Adam" appears in transcript — this is Edem (typo), correct?

        I found 9 action items:

        # | Action                                     | Pri | Owner(s)         | Due
        1 | Complete PRO registration for all writers   | P1  | Ransomed, All    | Mar 27
        2 | Send existing catalog to Edem for eval      | P1  | Ransomed, Ola    | Mar 27
        3 | Produce 3 demo tracks per Edem's brief      | P1  | Ola              | Apr 10
        4 | Research Tunefind + watch trailers           | P2  | All Members      | Ongoing
        5 | Review distributor sync opt-in/out terms     | P1  | Ransomed         | Mar 27
        6 | Design sync production music album          | P2  | Ola, Ransomed    | Apr 24
        7 | Develop cover strategy (5-10 songs)          | P2  | Ola, Ransomed    | Apr 24
        8 | Connect with Edem's recommended mix engineers| P2  | Ransomed         | After demos
        9 | Plan Christmas content by July               | P3  | Production Team  | Jul 2026

        Key decision: Exclusive sync partnership with Edem's company
        Open question: Which distributor are we currently using?

        Edit anything or "commit all".

Ransomed: Yes Adam = Edem. Drop 8, change 3 to P0, commit rest.

Claude: [DC: sqlite3 tracker.db "BEGIN; INSERT INTO actions ... (x8); INSERT INTO transcripts ...; COMMIT;"]

        Done — 8 actions committed to Action Tracker.
        #3 set to P0. #8 skipped (noted for later).
        Menu bar widget updated. Open tracker: http://localhost:5173
```

---

## Launch Command

```bash
cd ~/action-tracker
npm install
npm run dev
# → Frontend: http://localhost:5173
# → API: http://localhost:3001
```

**No API keys needed.** Claude handles all transcript parsing directly via Desktop Commander in conversation. The app is just UI + data — all intelligence lives in your Claude conversations.
