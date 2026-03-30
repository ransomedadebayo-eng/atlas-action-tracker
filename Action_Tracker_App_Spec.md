# ATLAS Action Tracker — App Spec

**For the agent building this:** You are building a cloud-hosted action tracker powered by Supabase (PostgreSQL). The Express API connects to Supabase via `@supabase/supabase-js`. The database schema uses `atlas_`-prefixed tables in the Supabase project `mnfovwxgmhacfljcpkio`. All consumers interact through the Express REST API — never directly with the database.

## Overview

A cloud-hosted action tracker with multiple access surfaces:

1. **Web app** (React + Express) — full UI for managing actions, team, transcripts, deployed on Cloudflare
2. **Claude** (any conversation) — parses transcripts, queries tracker, updates actions via the Express API from anywhere
3. **Claude Code** — same capabilities from the terminal via API calls

All surfaces read and write through the Express API, which connects to Supabase PostgreSQL (`atlas_actions`, `atlas_members`, `atlas_config`, `atlas_transcripts`, `atlas_activity_log`, `atlas_saved_views` tables). The database is initialized with 7 businesses and 7 team members.

---

## Why Local vs. Notion/SaaS

| Factor | ATLAS (Cloud-Hosted) | Notion/SaaS |
|--------|-----------|-------------|
| Claude can edit data directly | ✅ Yes, via Express API from anywhere | ❌ Limited to MCP view tools |
| Data ownership | ✅ Your Supabase project | ⚠️ Third-party servers |
| Access from anywhere | ✅ Cloud-hosted, always available | ✅ Also cloud |
| Custom features | ✅ Unlimited — I build what you need | ⚠️ Constrained by platform |
| Cost | ✅ Free (Supabase free tier) | ⚠️ Subscription tiers |
| Update cycle | ✅ Instant — just ask me | ⚠️ Feature requests to vendor |

---

## Tech Stack

| Layer | Technology | Why |
|-------|------------|-----|
| Frontend | React 18 + Vite | Fast dev, hot reload, component-based |
| Styling | Tailwind CSS | Utility-first, rapid iteration, no CSS files to manage |
| Backend | Node.js + Express | Lightweight API server, deployed on Cloudflare |
| Database | Supabase (PostgreSQL) via @supabase/supabase-js | Cloud-hosted, ACID-compliant, native JSONB, accessible from anywhere |
| AI Layer | Claude (any conversation / Claude Code) | YOU are the parser — no API key needed |
| State | React Query (TanStack Query) | Server state sync, caching, optimistic updates |
| Icons | Lucide React | Clean, consistent icon set |
| Runtime | Node.js 18+ | Deployed on Cloudflare |

### Competitive Landscape

Researched competitors in the meeting-to-actions space. None combine all our capabilities:

| Product | Approach | What They Lack |
|---------|----------|---------------|
| Meetily | Privacy-first transcription + summarization | No task management, no CLI integration |
| MeetGeek | Cloud-based conversation intelligence + analytics | No multi-business tracking |
| Fathom | One-tap recording with summaries + action items | Mobile-only, no custom business context |
| iWeaver | AI meeting action tracker with Zoom/Teams integration | No CLI/AI-assistant integration |

**Our unique position:** Cloud-hosted + multi-business team tracking + Claude as the intelligence layer (no API cost) + Claude can update tasks from any conversation anywhere via the Express API. No competitor does this.

**Single command to start:** `npm run dev` → serves frontend on `:5173`, API on `:3001`

---

## System Architecture — How It All Works Together

**Read this section first.** It explains how every component in this system interacts.

### The System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DATA LAYER (Source of Truth)                      │
│        Supabase PostgreSQL (project: mnfovwxgmhacfljcpkio)          │
│                                                                     │
│  Tables: atlas_actions | atlas_members | atlas_config |             │
│          atlas_transcripts | atlas_activity_log | atlas_saved_views  │
│  JSONB columns for arrays (owners, tags, businesses, etc.)          │
│  RPC functions: atlas_action_stats, atlas_member_stats, etc.        │
│                                                                     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  EXPRESS API    │
                    │  (Cloudflare)   │
                    │  /api/*         │
                    └──┬─────────┬────┘
                       │         │
              ┌────────▼──┐  ┌──▼──────────────┐
              │ WEB APP   │  │ CLAUDE           │
              │ React SPA │  │ (any session)    │
              │           │  │                  │
              │ Full UI   │  │ Parses           │
              │ CRUD,     │  │ transcripts,     │
              │ kanban,   │  │ queries,         │
              │ calendar  │  │ updates          │
              │ filters   │  │ via API calls    │
              └───────────┘  └─────────────────┘
              Cloudflare      Claude.ai / Code
```

### The Consumers — What Each Does

**1. Web App (React + Express)**
The primary UI. Users interact with actions through the browser: create, edit, filter, view kanban boards, calendar, team workload. The Express API uses `@supabase/supabase-js` to query Supabase PostgreSQL. React Query keeps the UI fresh.

- **Reads from:** Supabase via Express API (`atlas_actions`, `atlas_members`, `atlas_config`, `atlas_transcripts` tables)
- **Writes to:** Supabase via Express API (CRUD operations)
- **Connection:** `@supabase/supabase-js` client with service role key
- **Deployed on:** Cloudflare

**2. Claude (any conversation — Claude.ai, Claude Code, etc.)**
The intelligence layer. In any Claude conversation, the user can paste a transcript, ask about overdue items, reassign tasks, run weekly digests, etc. Claude reads/writes via the Express REST API from anywhere.

- **Reads from:** Express API (e.g., `GET /api/actions?status=not_started`)
- **Writes to:** Express API (e.g., `POST /api/actions`, `PUT /api/actions/:id`)
- **Parsing workflow:** User pastes transcript → Claude extracts actions → presents table for review → user confirms → Claude writes via API
- **Management workflow:** "What's overdue?" → Claude calls API, presents results

### Critical: The Express API Is the Interface

All consumers go through the Express REST API. No direct database access. This means:

1. **Any consumer can read/write from anywhere** — the API is cloud-hosted on Cloudflare
2. **Claude can update tasks from any session** — no need to be on the same machine
3. **The web app re-reads on focus** — refetches queries when `document.visibilityState` changes to "visible"
4. **Authentication** — Cloudflare Access JWT for tunnel traffic, Bearer token for API clients (Claude, scripts)

### Data Flow Examples

**Example A: User parses a transcript via Claude chat**
```
1. User pastes transcript in Claude.ai conversation
2. Claude calls: GET /api/members → gets team roster with aliases
3. Claude extracts 8 actions, presents for review in chat
4. User confirms: "commit all"
5. Claude calls: POST /api/actions/bulk with the 8 actions
6. User opens web app → UI shows all 8 new actions
```

**Example B: User marks an action done in the web app**
```
1. User clicks "Done" on an action in the React UI
2. React calls PUT /api/actions/:id with status: "done"
3. Express updates Supabase → returns updated action
4. Next Claude conversation: "What's overdue?" → Claude calls GET /api/actions/stats → action is gone
```

**Example C: User uploads a transcript in the web app for later parsing**
```
1. User drags a .txt file into the web app's transcript upload area
2. Express inserts transcript via Supabase with status='pending' and raw_text
3. Later, user tells Claude: "Parse my pending transcripts"
4. Claude calls: GET /api/transcripts?status=pending
5. Claude reads raw_text, parses, presents actions, user confirms
6. Claude calls: POST /api/transcripts/:id/commit with actions array
```

### What the Web App Must Implement

The Express API provides these capabilities over Supabase PostgreSQL:

| Feature | How it works |
|---------|-------------|
| Database connection | `@supabase/supabase-js` client with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars |
| List actions with filters | Supabase query builder: `.from('atlas_actions').select().eq().contains().ilike()` |
| Create/update/complete actions | `.insert()`, `.update()`, `.delete()` with activity log entries |
| List/add/edit team members | CRUD on `atlas_members` table |
| Upload pending transcripts | `.insert()` into `atlas_transcripts` with status='pending' + raw_text |
| View transcript history | `.select()` from `atlas_transcripts` (column selection for list views) |
| Dashboard stats | RPC function `atlas_action_stats()` — counts by status, business, priority, overdue |
| Member workload | RPC function `atlas_member_stats()` — action counts per owner |
| Re-read on focus | Frontend refetches queries when `document.visibilityState` changes to "visible" |

### Database Schema

The schema lives in Supabase project `mnfovwxgmhacfljcpkio` (us-east-1). All tables are prefixed with `atlas_`. Key constraints:
- Action IDs are UUID v4 strings (TEXT PRIMARY KEY)
- `owners` is stored as JSONB array (e.g., `["ransomed","ola"]`). Query with `@>` operator via `.contains()`
- `business` must match a business `id` from the `atlas_config` table
- `priority` is "p0", "p1", "p2", or "p3"
- `status` is one of: "not_started", "in_progress", "waiting", "blocked", "done"
- PostgreSQL triggers auto-sync `action_count` on transcripts when actions change

---

## Data Model

All data lives in Supabase PostgreSQL. Tables are prefixed with `atlas_` to avoid collisions with other projects.

### Schema Overview

**Tables:**
- `atlas_config` — key TEXT PK, value JSONB
- `atlas_members` — id TEXT PK, name, full_name, email, businesses JSONB, role, aliases JSONB, is_active BOOLEAN, created_at TIMESTAMPTZ
- `atlas_actions` — id TEXT PK, title, description, status TEXT (CHECK), business, priority TEXT (CHECK), due_date TEXT, owners JSONB, source_transcript_id FK, source_label, tags JSONB, notes, recurrence TEXT (CHECK), created_at/updated_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
- `atlas_transcripts` — id TEXT PK, title, date, business, participants JSONB, raw_text, summary, decisions JSONB, open_questions JSONB, action_count INT, status TEXT (CHECK), summary_file, created_at TIMESTAMPTZ
- `atlas_activity_log` — id SERIAL PK, action_id FK, event, old_value, new_value, actor, created_at TIMESTAMPTZ
- `atlas_saved_views` — id TEXT PK, name, filters JSONB, sort_by, sort_dir, created_at/updated_at TIMESTAMPTZ

**Indexes:** status, business, priority, due_date on `atlas_actions`

**RPC Functions:**
- `atlas_action_stats(business_filter)` — dashboard stats (counts by status, business, priority, overdue)
- `atlas_member_stats()` — workload per member (action counts by status)
- `atlas_member_detail_stats(member_id_param)` — single member action stats + overdue count

**Triggers:** Auto-sync `action_count` on `atlas_transcripts` when actions are inserted/updated/deleted

Pre-seeded with 7 members and 7 businesses (Riddim Exchange, Real Estate, Investments, Personal, Fitness, Learning Platform, Improvisr).

**JSONB pattern:** Fields like `owners`, `businesses`, `aliases`, `tags`, `decisions` are native JSONB arrays. Query with Supabase `.contains()` operator:

```js
// Find all actions owned by 'ransomed'
supabase.from('atlas_actions').select('*').contains('owners', ['ransomed']);

// Stats per member via RPC
supabase.rpc('atlas_member_stats');
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
2. Claude calls: GET /api/members → gets team roster with aliases
3. Claude extracts actions, presents structured table for review
4. User reviews: "Looks good, drop #4, change #6 to P1"
5. Claude calls: POST /api/actions/bulk with the confirmed actions
6. Web app shows new actions on next load/focus.
```

**Workflow B: App Upload → Claude Review (Secondary)**
```
1. User uploads transcript in the web app UI
2. Express inserts into atlas_transcripts via Supabase with status='pending'
3. Next Claude conversation: "Parse my pending transcripts"
4. Claude calls: GET /api/transcripts?status=pending
5. Claude parses, presents for review, user confirms
6. Claude calls: POST /api/transcripts/:id/commit with actions array
```

### What Claude Does During Parsing

1. **Read team roster** — `GET /api/members` → gets names, aliases, businesses
2. **Identify participants** — Match transcript names against members (including aliases). Ask about unknowns.
3. **Extract actions** — Find commitments, implied tasks, and decisions
4. **Assign owners** — Map speakers to member IDs. Ask when ambiguous.
5. **Infer priority** — Based on urgency language, dependencies, context
6. **Detect business** — Tag each action with the right business entity from config
7. **Suggest due dates** — From explicit mentions or inference
8. **Present for review** — Structured table in chat, all fields adjustable
9. **Write to database** — `POST /api/actions/bulk` or `POST /api/transcripts/:id/commit`
10. **Log activity** — Automatic via Express API with actor = "claude" (via `x-atlas-actor` header)

### API Calls Claude Uses

```bash
# Read team members for name matching
curl -H "Authorization: Bearer $ATLAS_API_TOKEN" \
  https://your-domain/api/members

# Read business definitions
curl -H "Authorization: Bearer $ATLAS_API_TOKEN" \
  https://your-domain/api/config/businesses

# Check for pending transcripts
curl -H "Authorization: Bearer $ATLAS_API_TOKEN" \
  "https://your-domain/api/transcripts?status=pending"

# Create actions in bulk
curl -X POST -H "Authorization: Bearer $ATLAS_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-atlas-actor: claude" \
  -d '{"actions": [{"title": "Action title", "business": "riddim_exchange", "priority": "p1", "owners": ["ransomed","ola"]}]}' \
  https://your-domain/api/actions/bulk

# Get dashboard stats
curl -H "Authorization: Bearer $ATLAS_API_TOKEN" \
  https://your-domain/api/actions/stats

# Get overdue actions
curl -H "Authorization: Bearer $ATLAS_API_TOKEN" \
  "https://your-domain/api/actions?status=not_started,in_progress,waiting&due_before=$(date +%Y-%m-%d)&sort_by=priority"

# Get workload per member
curl -H "Authorization: Bearer $ATLAS_API_TOKEN" \
  https://your-domain/api/members/stats
```

### Beyond Transcripts — Claude as Ongoing Tracker Manager

Since Claude has API access from anywhere, it's not just a parser — it's the tracker's brain:

- **"What's overdue?"** → `GET /api/actions?status=not_started,in_progress,waiting&due_before=2026-03-30`
- **"Reassign Ola's P1s to Kolade"** → `GET /api/actions/by-owner/ola` then `PUT /api/actions/bulk` with updated owners
- **"Add action: book studio, P1, assign Ola"** → `POST /api/actions` with JSON body
- **"Mark everything from the Edem call as done"** → `PUT /api/actions/bulk` with status: "done"
- **"Weekly digest"** → `GET /api/actions/stats` → present summary
- **"Who's overloaded?"** → `GET /api/members/stats` → present workload table

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
│   ├── db.js                     Supabase client (@supabase/supabase-js)
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
├── .env.example                  Required environment variables
└── README.md
```

---

## Claude Editability Contract

This is the key differentiator. The app is designed so I can modify it in future conversations:

### What Claude can do via the Express API (from anywhere):
1. **Parse transcripts** — Read transcripts, extract actions, commit via API
2. **Add/update/complete actions** — Full CRUD via REST API
3. **Manage team members** — Add new people, update roles, reassign actions
4. **Run queries** — Overdue report, workload analysis, weekly digest via API endpoints
5. **Add features** — Read existing code, create new components, wire them in (via Claude Code)
6. **Fix bugs** — Read error context, edit source files directly (via Claude Code)
7. **Change UI** — Edit React components, Tailwind classes, layout (via Claude Code)
8. **Modify schema** — Add columns via Supabase migrations
9. **Add views** — Create new saved view configurations via API

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
Claude:   1. GET /api/members → read team roster
          2. Claude reads transcript, extracts actions, presents table in chat
          3. Ransomed reviews: "Drop #4, change #6 to P1, commit the rest"
          4. POST /api/actions/bulk → commit confirmed actions
          Done. Actions live in tracker. $0 extra cost.
```

### Daily tracker management from conversation:
```
Ransomed: "What's overdue this week?"
Claude:   1. GET /api/actions/stats → get overdue count and details
          2. Present summary: "3 overdue — PRO registration (5 days), catalog send (3 days)..."
          3. Ransomed: "Mark PRO registration as done, push catalog to Friday"
          4. PUT /api/actions/bulk → update statuses and due dates
          Done.
```

---

## macOS Menu Bar Widget (Optional)

A persistent menu bar icon that shows your next 5 actions at a glance — no need to open the browser.

### Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Menu bar app | SwiftUI or Electron | Native macOS, lightweight |
| Data source | Reads from Express API | Same API the web app and Claude use — single source of truth |
| Refresh | Polls API on interval + on-focus | Auto-refreshes periodically |

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

The widget queries the API and displays the top 5 items sorted by this priority:

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
| "Quick Add" button | Opens a minimal input field in the popup to create a new action (title + business + priority, writes via API) |
| Hover on overdue badge | Tooltip showing count: "3 actions overdue" |

### Auto-Refresh

The widget polls the Express API periodically (e.g., every 60 seconds) and on app-focus to pick up changes made by Claude or the web app.

### Launch at Login

The menu bar app registers as a macOS login item so it starts automatically. Configurable in the app's preferences.

### Implementation Note

The menu bar widget can be built as a lightweight SwiftUI or Electron app that polls the Express API. Since the data is now cloud-hosted, the widget doesn't need to be on the same machine as the server — it just needs the API URL and auth token.

---

## Build Phases

### Phase 1 — Foundation + Team Members (DONE)
- Express server with @supabase/supabase-js connecting to Supabase PostgreSQL
- Full CRUD API for actions and team members
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
- **macOS menu bar widget** (optional) — polls Express API, shows next 5 items, overdue badge

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

Claude: [GET /api/members → reads team roster with aliases]

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

Claude: [POST /api/actions/bulk → commits 8 actions to Supabase]

        Done — 8 actions committed to Action Tracker.
        #3 set to P0. #8 skipped (noted for later).
        Web app updated. Open tracker to see all actions.
```

---

## Environment Variables

Required for deployment (see `app/.env.example`):

```bash
SUPABASE_URL=https://mnfovwxgmhacfljcpkio.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase Dashboard → Settings → API>
ATLAS_API_TOKEN=<your bearer token for API auth>
NODE_ENV=production
```

**No AI API keys needed.** Claude handles all transcript parsing via conversation. The app is UI + data — all intelligence lives in your Claude conversations. Claude accesses the tracker via the Express API from anywhere.
