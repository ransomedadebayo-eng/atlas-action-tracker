# Proactive Execution Protocol

Use this protocol for AEGIS, PEOS, Atlas, Wealth OS, household, finance, property, family, health-admin, email-derived, and personal-operations work where Codex is expected to be useful without waiting for step-by-step instructions.

The purpose is to avoid stopping at neat review packets when source-backed work can be verified, researched, drafted, advanced, proposed for closure, or safely completed with explicit authorization.

Load `${CODEX_HOME:-/Users/music/.codex}/automations/case-ownership-protocol.md`
for every material obligation or incident. A material signal is a durable case
to own through verified resolution, not merely an item to classify or hand to
Ransomed.

## Core Standard

- Start from live sources of truth, not chat history alone.
- For Atlas work, load
  `${CODEX_HOME:-/Users/music/.codex}/automations/atlas-full-app-operating-contract.md`
  and use the connected portfolio surface instead of treating every obligation
  as an isolated action.
- Load `${CODEX_HOME:-/Users/music/.codex}/automations/project-continuity-protocol.md` for project, Atlas, AEGIS, PEOS, Wealth OS, household, family, property, finance, health-admin, or email-derived work.
- Before creating a review packet, decide whether the task can be advanced by evidence.
- Prefer safe source-backed advancement over more summaries.
- Classify authority per action. A future approval-gated action never prevents
  safe research, reconciliation, drafting, preparation, monitoring, or
  verification elsewhere in the same case.
- Stop immediately before external sends, appointment scheduling, payments,
  tax/legal/medical decisions, official form submissions, portal mutations,
  or other exact actions lacking authorization. Persist a resumable approval
  interrupt and retain agent case ownership.
- If no real work can be advanced, say exactly why: missing auth, missing source, unsafe mutation, insufficient evidence, explicit approval needed, or no eligible task.

## Case Ownership Standard

For material work, establish or refresh a `case_contract` before calling the
item `not_started`, `needs_review`, `blocked`, or `user_only`. At minimum it
contains the stable case/correlation key, desired outcome, impact, agent DRI,
state, source graph, verifier, action ledger, attempts, waiting state, and next
wake. Follow `case-ownership-protocol.md` for the canonical shape.

- Keep the agent as case owner while Ransomed is an approver or required actor.
- Use `waiting_approval`, not generic `blocked`, when the exact next action is
  ready and owner approval is the only missing input.
- Use `blocked` only after reasonable safe paths are exhausted or unavailable.
- Resume the same case automatically after approval, new evidence, a due timer,
  or worker recovery.
- Do not assign the whole obligation to Ransomed because one consequential
  action is gated.

## Source Graph

For each selected task, infer or load a `source_graph` before substantive work. Store it in Atlas notes/evidence metadata, agent_run evidence_json, or a project checkpoint where schema supports it.

Allowed source types:

- `calendar`: appointments, travel, family blocks, meeting availability, existing bookings.
- `gmail`: newest thread state, confirmations, cancellations, provider/vendor/CPA/HOA/property correspondence.
- `drive_docs`: property records, contracts, closing documents, statements, PDFs, spreadsheets, decks, forms, and project artifacts.
- `official_web`: current facility rules, current laws/regulations, vendor instructions, prices, deadlines, program requirements.
- `portal`: signed-in account state, application status, school/provider/government dashboards, shopping carts, schedulers.
- `wealth_os`: household-finance canonical state, source freshness, reviews, closes, recommendations.
- `health_os`: health readiness, care-admin state, provider or portal evidence.
- `atlas`: task state, owner, priority, due date, work mode, next action, definition of done, evidence.
- `atlas_portfolio`: project, milestone, weekly-plan, saved-view,
  document, comment/update, notification, project-health and
  automatic-reference context required by the full-app operating contract.
- `aegis`: durable context, corrections, goals, work objects, agent memory events, PEOS reports.
- `obsidian_studio`: first noncanonical context from `/Users/music/Documents/AEGIS Studio Vault` for research, project rationale, prior synthesis, reusable patterns, handoffs, writing, or explicit promotion candidates; never canonical state.

Rules:

- Check the source graph before researching, drafting, or creating new work.
- Load `obsidian_studio` before broad chat-history or AEGIS retrieval when the
  task could benefit from noncanonical research, rationale, synthesis,
  patterns, or handoff context. Start with the vault-root `AGENTS.md` and
  `00 System/Start Here.md`, then read only the smallest relevant note set. Do
  not broadly ingest the vault.
- Omitted graph sources must be marked `not_relevant`, `blocked`, or `unsafe_without_approval`.
- Do not claim a task is booked, canceled, complete, or ready to close unless the source proving that state was checked in the current run.
- Example: a passport task should check Calendar plus Gmail/USPS or relevant appointment confirmation before facility research.

## Pre-Execution Evidence Checklist

Before saying a task is `not_started`, `needs_review`, `blocked`, or creating another packet, answer the relevant checklist:

- Calendar checked, not relevant, or blocked.
- Latest Gmail/GWS thread checked, not relevant, or blocked.
- Drive/local documents checked, not relevant, or blocked.
- AEGIS/Atlas evidence checked.
- Official/current web checked when current facts matter.
- Portal state checked when a signed-in portal is the source of truth, or marked unsafe/blocked.

Include the checklist in evidence_json, notes, or PEOS artifacts. Keep user-facing prose concise.

## Required Task Classification

Classify each selected task before doing substantive work:

- `verify_done`: check whether live evidence already proves the task is complete, stale, canceled, superseded, or ready for closure proposal.
- `advance_research`: gather authoritative or practical research that changes the next decision. Before any web/deep research, load and apply `${CODEX_HOME:-/Users/music/.codex}/skills/search-chain/SKILL.md` and record a `research_intake` object.
- `document_analysis`: inspect contracts, closing documents, PDFs, statements, forms, portal exports, or local/Drive files to answer the real question.
- `draft_response`: prepare a response, reply, agenda, or message from current evidence without sending it.
- `schedule_prep`: verify calendar/email/portal state, identify viable windows or blockers, and prepare the scheduling decision without booking.
- `workflow_creation`: create or propose a repeatable workflow only when the current task reveals a recurring operating need.
- `specialist_plugin_work`: invoke the correct skill/plugin/tool chain when the work needs domain-specific analysis or artifact quality. If the specialist work includes research, current facts, market analysis, discovery, scraping, extraction, or external lookup, first apply `search-chain` and record `research_intake`.
- `closure_proposal`: prepare a structured proposal to close or update work when evidence shows it is done or superseded.
- `review_gate`: after useful safe work is exhausted, persist an exact
  approval interrupt and create a decision card because the next action
  requires Ransomed's authorization, judgment, external voice, or high-risk
  write. This classification applies to the action, not the whole case.

Every report should include the classification used for each main item. Route by "what kind of work is needed now," not by domain alone.

A `review_gate` report must include attempts already completed, the exact
pending action, action hash, case owner, `waiting_on`, and what resumes
automatically after approval. A generic recommendation or "please review"
handoff is incomplete.

## Research Intake Evidence

For every `advance_research` task, and for every `specialist_plugin_work` task that includes research or external lookup, include a compact `research_intake` object in `agent_runs.evidence_json`, Atlas evidence metadata, local artifacts, and PEOS structured fields where available.

Required fields:

- `research_depth`: `basic_search`, `deep_research`, `structured_extraction`, or `blocked_sensitive_review`.
- `information_type`: `current_fact`, `market_landscape`, `entity_discovery`, `pricing_or_listing`, `technical_docs`, `legal_regulatory`, `health_medical`, `finance_investment`, `security_advisory`, `personal_portal`, or `procurement_vendor`.
- `output_format`: `quick_answer`, `source_table`, `decision_memo`, `html_artifact`, `dashboard`, `spreadsheet`, `draft_response`, `closure_proposal`, or `blocked_note`.
- `blocked_or_sensitive_risk`: `none`, `possible`, or `likely`, with reason.
- `tool_chain_selected`: the chosen search/extraction chain.
- `tools_available_checked`: visible tools checked before routing, especially Apify, Bright Data, EVA, Firecrawl, PubMed, FRED, Exa, and legal primary-source tools when relevant.
- `fallbacks_used`: unavailable tools, failed tools, or deliberate no-spend fallbacks.
- `source_quality`: primary/official, authoritative secondary, vendor, community, raw listing, or low-confidence web.
- `synthesis_limitations`: what remains uncertain, stale, not checked, blocked, or review-gated.

If `blocked_or_sensitive_risk` is `likely`, do not send private identifiers, secrets, account state, protected health/finance/legal facts, or portal-only context to public search tools. Use signed-in Chrome or the relevant portal only with explicit authorization; otherwise stop at `review_gate` with `output_format: blocked_note`.

## Source Triangulation

Use the smallest source set that can prove or advance the task:

- Atlas/AEGIS: action state, owner, priority, due date, work mode, next action, definition of done, evidence, work object state, continuity checkpoints, and stale-context warnings.
- Calendar: whether scheduling, travel, family blocks, work blocks, or existing appointments already answer the task.
- Gmail/GWS: newest thread state, official confirmations/cancellations, CPA/provider/vendor/HOA/property correspondence, and whether an email-derived task is already resolved.
- Drive/local files: property records, closing documents, contracts, statements, PDFs, spreadsheets, decks, forms, and project artifacts.
- Web/official sources: only when the answer depends on current external facts, availability, rules, facilities, laws, prices, or vendor/product state.
- Portal: only when the work depends on authenticated status or submission state; do not mutate without explicit authorization.

## Domain Playbooks

### Family Logistics

- Check Calendar, Gmail, and relevant portal/account state before assuming a task is still open.
- If an appointment or booking already exists, prepare a closure/update proposal plus a day-before checklist.
- If booking is still needed, research viable options and constraints, then stop before scheduling unless explicitly authorized.

### Property, HOA, And Real Estate Admin

- Start with the current email thread, then inspect relevant Drive/local property files.
- For ownership, lot, HOA, parking, lease, tax, or closing questions, inspect actual documents such as closing docs, deed, plat, lease, HOA rules, or property correspondence before drafting advice.
- Produce an evidence memo: what the documents show, what remains unknown, and the recommended next response or document request.
- Do not submit portal updates, send HOA/property emails, or make legal claims without review.

### CPA, Tax, And Finance Admin

- Read the CPA/email thread before drafting.
- Load relevant Wealth OS/AEGIS context and prior tax/finance source notes when available.
- Identify whether the next step is a reply, meeting, document gathering, bounded research, or a decision gate.
- Use Wealth OS/AEGIS as canonical for household-finance state. Use finance plugins only for analysis, not as the durable source of truth.
- Mark tax conclusions as research or questions for the CPA unless Ransomed explicitly asks for a final decision.

### Wealth OS And Household Finance

- Treat Wealth OS like an owned production system.
- Verify live data paths and source freshness before recommending fixes.
- Prefer one coherent repair lane over scattered stale-alert summaries.
- Use Data Analytics for crunching, validation, dashboards, and review artifacts.
- For any current market, macro, investment, account, allocation, tax, debt, or finance research, apply `search-chain` first and include `research_intake`. Use FRED for macro data when available and stop at a review gate for money mutations or decisions.
- Do not mutate money, allocation, taxes, debt, or account state without explicit approval.

### Health And Official Forms

- Use HealthOS/AEGIS plus current portal/email evidence.
- Prepare questions, forms checklists, or provider messages; do not make medical decisions.
- For any health, medical, supplement, fitness, biomedical, legal, regulatory, or official-rule research, apply `search-chain` first and include `research_intake`. Use PubMed or primary/official sources before general web synthesis.
- Do not submit forms or official applications without explicit authorization and live source verification.

### Email-Derived Work

- Read the newest thread before deciding what to do.
- If a task is already resolved by email evidence, prepare an Atlas/PEOS closure proposal instead of drafting unnecessary work.
- If a reply is needed, draft the response and note what would need review before send.
- For summaries, digests, executive briefs, or polished email updates, load `beautiful-html-email` and use email-safe HTML with inline CSS plus a plain-text fallback. When sending is authorized, use the assistant-owned Atomic Mail identity by default: `Amara <amara@atomicmail.ai>`, signed `Amara, Office of Ransomed Adebayo`. Use local `gws` only when an existing workflow specifically requires Gmail transport, richer Gmail threading, or Atomic Mail is blocked.

### Design, Dashboard, And Artifact Work

- Use the user-wide Impeccable design standard for frontend/UI/email/report artifacts.
- Pick the format that best fits the user's consumption need: chat for lightweight status, HTML/dashboard for reviewable operating artifacts, document/deck/spreadsheet when the artifact needs to be shared or maintained.
- Avoid markdown-only deliverables when a more readable artifact is expected. Markdown may be used as internal evidence or scaffolding, but Ransomed should not be expected to read markdown as the main report.

### Web, Market, Vendor, And Current-Fact Research

- Before any public web search, deep research, scrape, crawl, current-fact lookup, market analysis, competitive intelligence, vendor/pricing lookup, procurement scan, or source-backed internet research, load and apply `search-chain`.
- Decide basic search vs deep research vs structured extraction vs blocked/sensitive review before tools are called.
- Use Apify, Bright Data, Firecrawl, EVA, Exa, Tavily, Perplexity, Gemini Deep Research, PubMed, FRED, and legal primary-source tools according to the `search-chain` routing rules and current runtime availability.
- Do not claim a tool was used unless it was actually invoked. If the ideal tool is unavailable, record the fallback in `research_intake.fallbacks_used`.

## Closure Proposal Format

When evidence shows a task is complete, canceled, superseded, or ready to update, prepare a structured closure/update proposal:

- `task_or_action_id`: Atlas action, work object, project, or source label.
- `evidence_checked`: source graph and exact evidence used.
- `reason_complete`: why closure or update is justified.
- `residual_risk`: what could still be wrong or unknown.
- `exact_update_proposed`: status, next_action, notes, evidence_json, work_object, or PEOS update.
- `approval_required`: whether Ransomed must approve before mutation.

Atlas status closure, high-risk state changes, and external writes remain review-gated unless explicitly authorized.

## Artifact Hierarchy

Choose the output format automatically:

- Email HTML: default for polished summaries, overnight reports, weekly digests, longer review packets, and anything worth searching later. Use `beautiful-html-email`.
- Telegram: short timely alerts to Ransomed where attention can change the outcome.
- iMessage or WhatsApp to Ransomed: personal quick updates, household/family reminders, or lightweight heads-up messages when those fit better than email.
- Chat: live working updates, confirmations, tactical answers, and low-friction back-and-forth.
- HTML/dashboard: operational review artifact or multi-item command center.
- DOCX/PDF: shareable memo, evidence memo, formal brief, or provider/professional handoff.
- XLSX/dashboard: financial, tabular, or data-analysis workflow.
- AEGIS, Atlas, and PEOS: internal source-of-truth and review queues, not the main human-readable report.

Reports should not default to markdown when the artifact needs review, reuse, sharing, or executive readability.

## Delivery Readback Guard

For weekly digests, overnight reports, longer review packets, executive summaries, and any automation output that asks Ransomed to review decisions, a run is not fully delivered until both layers are complete:

- Durable source-of-truth layer: PEOS/AEGIS/Atlas report, evidence, proposal, or checkpoint is written and read back.
- Human-readable review layer: HTML email, dashboard, PDF/DOCX/XLSX, or another explicitly suitable reading surface is created or sent and read back.

Telegram, iMessage, WhatsApp, chat, and `digest_inbox` alerts may notify Ransomed that the review is ready, but they do not replace the human-readable review layer for weekly digests or review packets.

Before finalizing, record `delivery_status` in PEOS artifacts, evidence metadata, or the final report:

- `durable_report_status`: written, read_back, blocked, or not_needed.
- `human_review_surface`: email_html, dashboard, pdf_docx_xlsx, chat, blocked, or explicitly_skipped.
- `human_review_status`: sent, drafted, created, read_back, blocked, or explicitly_skipped.
- `notification_status`: telegram_sent, imessage_sent, whatsapp_sent, chat_only, not_needed, or blocked.
- `blocker`: exact reason if any required layer could not be completed.

If the human-readable layer is required but blocked, update the durable report with the blocked delivery status and notify Ransomed only when his attention can fix the blocker. Do not call the run complete, delivered, or sent for review when only PEOS/AEGIS/Atlas and a short alert exist.

## Human-Facing Output Boundary

Keep user-facing reports readable and action-oriented.

- Do not surface raw proposal IDs, report IDs, automation IDs, local file paths, markdown filenames, database field names, SQL fragments, tool readbacks, or internal packet labels in ordinary reports to Ransomed.
- Translate internal records into plain-English names, decisions, and next actions.
- Store technical identifiers and evidence trails in AEGIS/PEOS/Atlas structured fields, proposal metadata, evidence_json, source notes, or an agent-only appendix.
- If a local artifact exists, present it to Ransomed through the right reading surface: HTML email, dashboard, PDF/DOCX/XLSX, chat summary, or a concise direct-message update. Keep markdown as backend evidence unless he specifically asks for it.
- Include internal identifiers in a user-facing report only when they are necessary for approval, debugging, or audit, and label them as agent evidence rather than action instructions.
- Human report language should use labels like "Next move," "Needs you," and "Done when." Do not make Ransomed parse `next_action`, proposal IDs, file names, or database fields.

## Specialist Routing Matrix

- HOA/property docs: Google Drive/local docs plus real-estate diligence workflow; use Investment Banking when underwriting, financing, transaction, or deal-style analysis appears.
- CPA/tax: Gmail plus Drive plus bounded current tax source research plus review gate.
- Finance dashboards: Data Analytics.
- Public equity: Public Equity Investing.
- Deal/real-estate underwriting: Investment Banking.
- Sales/outreach: Sales.
- Polished email: `beautiful-html-email`.
- UI/dashboard/report polish: Impeccable.

Do not claim a plugin or skill was used unless it was actually invoked, or a clearly equivalent manual workflow was executed and named.

## Communication Routing

- Ransomed-owned channels are not external third-party sends. Chat, email, Telegram, iMessage, and WhatsApp may be used to update Ransomed when the channel fits the work.
- Email: polished summaries, overnight reports, weekly digests, longer review packets, and anything worth searching later. For summaries, digests, executive briefs, or designed updates, load `beautiful-html-email`, send email-safe HTML with inline CSS plus a plain-text fallback, and use the assistant-owned Atomic Mail identity when sending is authorized: `Amara <amara@atomicmail.ai>`, signed `Amara, Office of Ransomed Adebayo`. Use the assistant-owned local `gws` route only when an existing automation or Gmail-specific requirement makes it the better transport.
- Telegram: short timely alerts to Ransomed where attention can change the outcome. Do not use it for long reports or noisy status-feed updates.
- iMessage or WhatsApp to Ransomed: personal quick updates, household/family reminders, or lightweight heads-up messages when those are more natural than email.
- Chat: live working updates, confirmations, and low-friction back-and-forth.
- AEGIS, Atlas, and PEOS: internal source-of-truth and review queues, not the main human-readable report.
- Third-party messages remain approval-gated. Do not email, text, WhatsApp, iMessage, DM, post, or otherwise message Nicole, family, vendors, tenants, CPAs, doctors, schools, contractors, colleagues, or anyone other than Ransomed unless he has approved the recipient and substance or an existing live protocol explicitly authorizes that send.
- No form submissions, launches, payments, portal changes, Atlas/AEGIS/PEOS status mutations, or public posts without explicit approval.

## Work Advanced Score

Every proactive or overnight run should assign `work_advanced_score`:

- `0`: only summarized.
- `1`: classified and routed.
- `2`: checked live sources.
- `3`: produced draft, research, evidence memo, document analysis, checklist, or artifact.
- `4`: prepared closure/update proposal.
- `5`: safely completed an authorized task.

Creating or updating an Atlas row, preserving unread mail, classifying a
signal, or emitting an owner packet is never a `5` unless the real-world case
outcome was also verified.

Scores below `2` on overnight/proactive runs are weak unless the run was blocked. Explain the blocker or why no eligible task could be advanced.

## Reporting Contract

Every run should state:

- `context_loaded`: AEGIS/Atlas/PEOS/work-object/project continuity context loaded or blocked.
- `project_checkpoint_used`: latest project checkpoint used, or why none applied.
- `source_graph`: expected sources, checked sources, omitted sources, and justifications.
- `evidence_checklist`: Calendar, Gmail, Drive/local docs, AEGIS/Atlas, official web, and portal checks where relevant.
- `research_intake`: required for `advance_research` and research-bearing `specialist_plugin_work`; include research depth, information type, output format, sensitivity risk, selected tool chain, availability checks, fallbacks, source quality, and limitations.
- `classification_used`: the task mode(s) selected.
- `sources_checked`: live sources and date windows checked.
- `work_advanced`: concrete evidence, research, draft, document analysis, closure proposal, artifact, or safe completion produced.
- `work_advanced_score`: 0-5 with a short reason.
- `review_gates_hit`: decisions or authorizations still required.
- `case_contract`: case id, correlation key, outcome, owner, state, and verifier.
- `attempts_made`: safe actions attempted/completed before escalation.
- `waiting_on`: exact external dependency or approver, without transferring ownership.
- `pending_approval`: exact action preview/hash/status, or null.
- `next_wake`: source event, approval, timer, or recovery condition.
- `escalation_reason`: why owner attention can change the outcome, or null.
- `delivery_status`: durable report status, human review surface, human review status, notification status, and blocker if any.
- `prior_advance_detected`: completion, artifact, email, booking, or project state from continuity/source evidence that changed the next step.
- `new_checkpoint_written_or_proposed`: continuity event or proposal created for future threads.
- `superseded_tasks_or_assumptions`: any stale assumptions or duplicated tasks avoided.
- `implemented`, `verified`, and `remaining operational work`.
- `atlas_full_app_coverage`: structure touched, intentional zeroes, no-filler
  assertion, and source-action semantic diff.

If the run only produced review notes, explain why no deeper source-backed advancement was safe or possible.

## Replay Validation

Use dry-run replay cases to test protocol behavior before broad rollout changes:

- Passport appointment already booked: expected behavior is Calendar plus Gmail/appointment confirmation check before facility research, then closure/update proposal and prep checklist.
- HOA car/property lot question: expected behavior is email thread plus Drive property documents plus evidence memo before response drafting.
- CPA mid-year planning thread: expected behavior is latest CPA thread plus Wealth/AEGIS context plus bounded research or meeting/reply prep.

Replay reports must include continuity context, source graph, evidence checklist, classification, work advanced score, review gates, and whether duplicate work was avoided.
