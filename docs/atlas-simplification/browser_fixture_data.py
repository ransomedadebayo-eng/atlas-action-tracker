"""Synthetic data only. No credentials, remote resources, or production identifiers."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def seed_data():
    now = datetime.now(timezone.utc)
    stamp = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    today = now.astimezone(ZoneInfo("America/Los_Angeles")).date()
    monday = today - timedelta(days=today.weekday())
    old = (now - timedelta(days=40)).isoformat().replace("+00:00", "Z")
    businesses = [dict(id="atlas", name="Atlas", color="#3b82f6", frozen=False),
                  dict(id="personal", name="Personal", color="#a855f7", frozen=False)]
    members = [dict(id=key, name=name, full_name=name, principal_type=kind, is_active=True,
                    role=role, businesses=["atlas", "personal"], aliases=[], created_at=old)
               for key, name, kind, role in [("ransomed", "Ransomed", "owner", "Owner"),
                                            ("codex", "Codex", "agent", "Engineering"),
                                            ("claude", "Claude", "agent", "Research")]]
    def action(key, title, status, business="atlas", **extra):
        row = dict(id=key, identifier="ATLAS-QA-" + key.upper(), title=title, status=status,
                   business=business, priority="p2", owners=["codex"], tags=["synthetic-qa"],
                   description="Synthetic local validation work; no production record.",
                   notes="Historical notes remain unchanged.", evidence_json={}, revision=1,
                   created_at=old, updated_at=old, due_date=today.isoformat(), review_date=None,
                   approval_state="not_required", work_mode="autonomous", archived_at=None,
                   completed_at=None, resolution=None, recurrence="none", estimate_points=None,
                   next_action="Review the synthetic result.", definition_of_done="Verify the local result.",
                   project_id="p1" if business == "atlas" else "p2", project_milestone_id=None,
                   parent_action_id=None, agent_assignment_id=None, blocked_by=[])
        row.update(extra)
        return row
    actions = [action("open", "Triage the local release plan", "open"),
               action("todo", "Prepare the validation checklist", "not_started"),
               action("active", "Review the project contract", "in_progress", "personal"),
               action("waiting", "Review the synthetic owner packet", "waiting", approval_state="needs_review", work_mode="review_required", owners=["ransomed"]),
               action("blocked", "Resolve the synthetic dependency", "blocked", blocked_by=["qa-office"]),
               action("done", "Verify the completed release", "done", completed_at=stamp, updated_at=stamp,
                      evidence_json=dict(version=2, kind="manual_attestation", summary="Synthetic verification passed.", sources=[], verification=dict(status="attested"))),
               action("canceled", "Canceled task retains status", "canceled"),
               action("legacy-cancelled", "Historical cancelled alias", "cancelled"),
               action("archived", "Archived validation history", "archived", archived_at=old, due_date=None)]
    projects = [dict(id="p1", name="Atlas simplification", summary="One project container, one weekly cadence.",
                     description="Synthetic project for local UI validation.", business="atlas", status="in_progress", health="on_track", priority="p1",
                     members=["codex", "ransomed"], lead_id="codex", start_date=(today - timedelta(days=45)).isoformat(),
                     target_date=(today + timedelta(days=14)).isoformat(), update_frequency="weekly", revision=1,
                     sort_order=1000, created_at=old, updated_at=old, archived_at=None, created_by="codex", updated_by="codex"),
                dict(id="p2", name="Family plans", summary="Keep useful context together.", description="Personal synthetic planning context.",
                     business="personal", status="paused", health="no_update", priority="p2", members=["ransomed"], lead_id="ransomed",
                     start_date=today.isoformat(), target_date=(today + timedelta(days=30)).isoformat(), update_frequency="weekly", revision=1,
                     sort_order=2000, created_at=stamp, updated_at=stamp, archived_at=None, created_by="ransomed", updated_by="ransomed")]
    # Keep p1 stale: its historical action dates and project update all predate 14 days.
    next(row for row in actions if row["id"] == "done")["project_id"] = "p2"
    milestone = dict(id="m1", project_id="p1", name="Validation complete", status="planned", target_date=(today + timedelta(days=7)).isoformat(), revision=1, created_at=old, updated_at=old)
    def version(revision, title, content, created):
        return dict(id="document-qa-version-" + str(revision), document_id="document-qa", revision=revision, title=title, content=content, actor="codex", created_at=created)
    document = dict(id="document-qa", title="Local QA operating notes", content="# Local QA\n\nThis document exists only in the local fixture server.\n\n## Checks\n\n- [ ] Verify the synthetic edit and reload.\n",
                    context_type="project", context_id="p1", status="active", revision=1, created_at=old, updated_at=stamp,
                    created_by="codex", updated_by="codex", last_realtime_edit_at=None, icon=None, color=None)
    versions = [version(1, document["title"], document["content"], stamp), version(0, "Local QA notes", "# Local QA\n\nInitial synthetic draft.\n", old)]
    items = [dict(id="w1", kind="must_win", rank=0, plan_date=None, title="Verify the completed release", source_action_id="done", notes="Confirm delivery evidence.", rationale="Prove the outcome."),
             dict(id="w2", kind="must_win", rank=1, plan_date=None, title="Triage the local release plan", source_action_id="open", notes="Keep the scope bounded.", rationale="Classify the work."),
             dict(id="w3", kind="day_focus", rank=0, plan_date=monday.isoformat(), title="Verify the completed release", source_action_id="done", notes="One clear focus."),
             dict(id="w4", kind="carryover", rank=0, plan_date=None, title="Review the project contract", source_action_id="active", notes="Carried from the prior week."),
             dict(id="w5", kind="context", rank=0, plan_date=None, title="Local-only validation", source_action_id=None, notes="All edits remain in server memory.")]
    week = dict(id="week-qa", week_start=monday.isoformat(), title="Local QA operating plan", summary="Synthetic plan validates the weekly scorecard and lifecycle.",
                status="published", version=1, revision=1, items=items, commitments=[], source_coverage={}, calendar_acknowledged=True, created_at=stamp, updated_at=stamp, published_at=stamp)
    previous = dict(id="week-review-qa", week_start=(monday - timedelta(days=7)).isoformat(), title="Synthetic plan awaiting publication", summary="Review this local-only example.",
                    status="review_requested", version=1, revision=1, items=[], commitments=[], source_coverage={}, calendar_acknowledged=True, created_at=stamp, updated_at=stamp, published_at=None)
    comments = [dict(id="comment-qa", target_type="action", target_id="open", parent_comment_id=None, thread_root_id=None,
                     body="This synthetic discussion is safe to edit, reply to, resolve, and reload.", mentions=[], attachments=[], anchor=None,
                     author_id="codex", created_by="codex", updated_by="codex", revision=1, status="active", resolved_at=None, resolved_by=None, created_at=stamp, updated_at=stamp)]
    notifications = [dict(id="n1", principal_id="codex", status="unread", revision=1, created_at=stamp,
                          event=dict(id="event-qa-1", category="comments", urgency="normal", actor="codex", summary="A synthetic comment needs review", target_url="/actions/open")),
                     dict(id="n2", principal_id="codex", status="read", revision=1, created_at=stamp,
                          event=dict(id="event-qa-2", category="project_updates", urgency="normal", actor="codex", summary="Synthetic project update available", target_url="/projects/p1")),
                     dict(id="n-history", principal_id="codex", status="unread", revision=1, created_at=stamp,
                          event=dict(id="event-qa-history", category="cycles", urgency="normal", actor="codex", summary="Historical cycle notification redirects to Week", target_url="/cycles/cycle-qa"))]
    preferences = [dict(id="pref-" + channel, principal_id="codex", channel=channel, category="all", delivery_mode="immediate" if channel == "inbox" else "disabled", digest_window_minutes=None, revision=0)
                   for channel in ["inbox", "browser", "email", "slack", "webhook"]]
    report = dict(id="report-qa", automation_id="atlas-stewardship-daily", status="completed", title="Synthetic stewardship report", summary="Local fixture checks are ready.",
                  implemented="Prepared the synthetic work.", verified="Readback available locally.", remaining_work="Review the local example.", artifacts_json=dict(schedule="Daily", route_used="synthetic_fixture"), created_at=stamp, run_completed_at=stamp)
    return dict(businesses=businesses, members=members, actions={row["id"]: row for row in actions}, projects={row["id"]: row for row in projects},
                milestones={milestone["id"]: milestone}, project_updates={}, dependencies={}, views={}, activity=[], relations={},
                weeks={week["id"]: week, previous["id"]: previous}, documents={document["id"]: document}, document_versions={document["id"]: versions}, document_operations={}, document_conflicts={},
                comments={row["id"]: row for row in comments}, reactions={}, discussion_subscriptions={}, notifications={row["id"]: row for row in notifications}, preferences={row["id"]: row for row in preferences}, subscriptions={},
                journal={"journal-qa": dict(id="journal-qa", title="Synthetic reflection", body="Projects and weekly plans keep the local model simple.", kind="reflection", source="atlas_user_journal", tags=["qa"], review_state="unreviewed", promoted_targets=[], archived_at=None, captured_at=stamp, created_at=stamp, updated_at=stamp)},
                transcripts={"transcript-qa": dict(id="transcript-qa", title="Synthetic planning conversation", date=today.isoformat(), business="atlas", participants=["ransomed", "codex"], summary="A local example with no recorded meeting.", decisions=["Validate the simplified surfaces."], open_questions=["Does every route remain readable?"], action_count=1, status="reviewed", raw_text="Synthetic speaker: Review the local validation results.", created_at=stamp, actions=[])},
                proposals={"proposal-qa": dict(id="proposal-qa", title="Review the synthetic validation result", summary="This proposal is local to the fixture server.", recommendation="Review the local evidence.", entity_type="task", status="pending", proposed_by="codex", proposed_at=stamp)},
                reports=[report], connections={}, integration_subscriptions={}, deliveries=[], inbound=[], idempotency={})
