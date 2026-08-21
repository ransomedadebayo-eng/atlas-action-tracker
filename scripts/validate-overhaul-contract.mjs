import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')

function filesUnder(directory) {
  const absolute = join(root, directory)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name)
    return statSync(path).isDirectory()
      ? filesUnder(relative(root, path))
      : [path]
  })
}

function contents(directory, extensions) {
  return filesUnder(directory)
    .filter((path) => extensions.some((extension) => path.endsWith(extension)))
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
}

const failures = []
const requireContract = (condition, message) => {
  if (!condition) failures.push(message)
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const workerSources = contents('worker/src', ['.ts'])
const workerText = workerSources.map(({ text }) => text).join('\n')
const appText = contents('app/src', ['.js', '.jsx'])
  .filter(({ path }) => !/\.(test|spec)\.[^.]+$/.test(path))
  .map(({ text }) => text)
  .join('\n')
const migrationText = contents('migrations', ['.sql']).map(({ text }) => text).join('\n').toLowerCase()
const wrangler = readFileSync(join(root, 'worker/wrangler.toml'), 'utf8')
const databaseRegressionPath = join(root, 'supabase/tests/atlas_trust_overhaul_test.sql')
const databaseRegression = existsSync(databaseRegressionPath) ? readFileSync(databaseRegressionPath, 'utf8') : ''
const projectRegressionPath = join(root, 'supabase/tests/atlas_projects_test.sql')
const projectRegression = existsSync(projectRegressionPath) ? readFileSync(projectRegressionPath, 'utf8') : ''
const actionStructureRegressionPath = join(root, 'supabase/tests/atlas_action_structure_test.sql')
const actionStructureRegression = existsSync(actionStructureRegressionPath) ? readFileSync(actionStructureRegressionPath, 'utf8') : ''
const cycleRegressionPath = join(root, 'supabase/tests/atlas_cycles_test.sql')
const cycleRegression = existsSync(cycleRegressionPath) ? readFileSync(cycleRegressionPath, 'utf8') : ''
const projectViewRegressionPath = join(root, 'supabase/tests/atlas_project_views_test.sql')
const projectViewRegression = existsSync(projectViewRegressionPath) ? readFileSync(projectViewRegressionPath, 'utf8') : ''
const initiativeRegressionPath = join(root, 'supabase/tests/atlas_initiatives_test.sql')
const initiativeRegression = existsSync(initiativeRegressionPath) ? readFileSync(initiativeRegressionPath, 'utf8') : ''
const templateDocumentRegressionPath = join(root, 'supabase/tests/atlas_templates_documents_test.sql')
const templateDocumentRegression = existsSync(templateDocumentRegressionPath) ? readFileSync(templateDocumentRegressionPath, 'utf8') : ''
const collaborationRegressionPath = join(root, 'supabase/tests/atlas_collaboration_test.sql')
const collaborationRegression = existsSync(collaborationRegressionPath) ? readFileSync(collaborationRegressionPath, 'utf8') : ''
const releasesRegressionPath = join(root, 'supabase/tests/atlas_releases_test.sql')
const releasesRegression = existsSync(releasesRegressionPath) ? readFileSync(releasesRegressionPath, 'utf8') : ''
const insightsExportsRegressionPath = join(root, 'supabase/tests/atlas_insights_exports_test.sql')
const insightsExportsRegression = existsSync(insightsExportsRegressionPath) ? readFileSync(insightsExportsRegressionPath, 'utf8') : ''
const workflowsTriageRegressionPath = join(root, 'supabase/tests/atlas_workflows_triage_test.sql')
const workflowsTriageRegression = existsSync(workflowsTriageRegressionPath) ? readFileSync(workflowsTriageRegressionPath, 'utf8') : ''
const notificationsIntegrationsRegressionPath = join(root, 'supabase/tests/atlas_notifications_integrations_test.sql')
const notificationsIntegrationsRegression = existsSync(notificationsIntegrationsRegressionPath) ? readFileSync(notificationsIntegrationsRegressionPath, 'utf8') : ''
const realtimeDocumentsRegressionPath = join(root, 'supabase/tests/atlas_realtime_documents_test.sql')
const realtimeDocumentsRegression = existsSync(realtimeDocumentsRegressionPath) ? readFileSync(realtimeDocumentsRegressionPath, 'utf8') : ''
const migrationReconciliationPath = join(root, 'docs/migration-ledger-reconciliation-2026-08-21.json')
const migrationReconciliation = existsSync(migrationReconciliationPath)
  ? JSON.parse(readFileSync(migrationReconciliationPath, 'utf8'))
  : null

requireContract(!existsSync(join(root, 'app/server')), 'duplicate Express backend app/server must be removed')
requireContract(!/\.from\(['"]atlas_actions['"]\)\s*\.delete\s*\(/s.test(workerText), 'Worker must not hard-delete atlas_actions')
requireContract(!/\.from\(['"]atlas_activity_log['"]\)\s*\.delete\s*\(/s.test(workerText), 'Worker must not delete atlas_activity_log')
requireContract(!/router\.delete\s*\(/.test(workerText) || /HARD_DELETE_DISABLED/.test(workerText), 'any DELETE compatibility route must return the hard-delete-disabled contract')
requireContract(!/runAutomationJob|runScheduledProtocolJobs|\bscheduled\s*\(/.test(workerText), 'Worker must not execute automations')
requireContract(!/^\s*\[triggers\]/m.test(wrangler) && !/\bcrons\s*=/.test(wrangler), 'Worker cron triggers must be absent')
requireContract(!/\bnicole\b/i.test(appText), 'active UI must not expose Nicole')
requireContract(/ATLAS_OWNER_EMAILS/.test(workerText), 'Worker must enforce an owner email allowlist')
requireContract(/ATLAS_API_PRINCIPALS_JSON/.test(workerText), 'Worker must use scoped machine principals')
requireContract(/\^\[a-z\]\+:\[a-z\]\+\(\?:_\[a-z\]\+\)\*\$/.test(workerText), 'machine-principal scope parsing must preserve reviewed underscore scope segments')
requireContract(/identifier\.ilike/.test(workerText), 'action search must include stable ATLAS identifiers')
requireContract(/action\.identifier/.test(appText), 'action list and detail UI must display stable ATLAS identifiers')
requireContract((workerText.match(/buildWebhookSigningInput\(/g) || []).length >= 3, 'webhook verification, outbound delivery, and inbound checks must sign the full header/body envelope')
requireContract(/Atlas-Signature-Version/.test(workerText) && /atlas-signature-version/.test(workerText), 'webhook senders and receivers must require signature version v1')
requireContract(/codex/.test(workerText) && /claude/.test(workerText) && /ransomed/.test(workerText), 'the three canonical principals must be represented')
requireContract(/PRINCIPAL_ROSTER_FIXED/.test(workerText), 'the API must reject creation of additional principals')
requireContract(/revoke[\s\S]*function/.test(migrationText), 'migrations must revoke privileged function execution')
requireContract(/prevent[\s\S]*delete|delete[\s\S]*forbidden|raise exception[\s\S]*delete/.test(migrationText), 'migrations must guard destructive deletion')
requireContract(/complete_atlas_action/.test(migrationText), 'atomic completion RPC migration is required')
requireContract(/archive_atlas_action/.test(migrationText), 'atomic archive RPC migration is required')
requireContract(/restore_atlas_action/.test(migrationText), 'atomic restore RPC migration is required')
requireContract(/select plan\(46\)/i.test(databaseRegression) && /select \* from finish\(\)/i.test(databaseRegression), '46-assertion pgTAP regression contract is required')
requireContract(/create table if not exists public\.atlas_projects/.test(migrationText), 'first-class ATLAS projects migration is required')
requireContract(/atlas_project_milestones/.test(migrationText) && /atlas_project_updates/.test(migrationText) && /atlas_project_dependencies/.test(migrationText), 'project milestones, updates, and dependencies are required')
requireContract(/assign_atlas_action_to_project/.test(migrationText) && /remove_atlas_action_from_project/.test(migrationText), 'transactional project action membership RPCs are required')
requireContract(/post_atlas_project_update/.test(migrationText), 'transactional project health updates are required')
requireContract(/select plan\(25\)/i.test(projectRegression) && /select \* from finish\(\)/i.test(projectRegression), '25-assertion project pgTAP regression contract is required')
requireContract(/create table if not exists public\.atlas_action_relations/.test(migrationText), 'typed ATLAS action relations migration is required')
requireContract(/set_atlas_action_parent/.test(migrationText) && /create_atlas_sub_action/.test(migrationText), 'transactional action hierarchy RPCs are required')
requireContract(/mark_atlas_action_duplicate/.test(migrationText) && /duplicate_resolution/.test(migrationText), 'typed duplicate resolution is required')
requireContract(/select plan\(39\)/i.test(actionStructureRegression) && /select \* from finish\(\)/i.test(actionStructureRegression), '39-assertion action structure pgTAP regression contract is required')
requireContract(/create table if not exists public\.atlas_cycle_schedules/.test(migrationText) && /create table if not exists public\.atlas_cycles/.test(migrationText), 'ATLAS cycle schedule and timebox migrations are required')
requireContract(/configure_atlas_cycle_schedule/.test(migrationText) && /complete_atlas_cycle/.test(migrationText), 'transactional cycle generation and rollover RPCs are required')
requireContract(/atlas_cycle_scope_events/.test(migrationText) && /success_percent_snapshot/.test(migrationText), 'cycle graph and immutable success snapshots are required')
requireContract(/select plan\(50\)/i.test(cycleRegression) && /select \* from finish\(\)/i.test(cycleRegression), '50-assertion cycle pgTAP regression contract is required')
requireContract(/atlas_saved_view_activity_log/.test(migrationText) && /atlas_saved_views_one_default_idx/.test(migrationText), 'typed, auditable saved project views are required')
requireContract(/move_atlas_project_order/.test(migrationText) && /move_atlas_project_timeline/.test(migrationText), 'transactional project ordering and timeline movement RPCs are required')
requireContract(/atlas_projects_manage_completed_at/.test(migrationText), 'project completion-window timestamps are required')
requireContract(/select plan\(50\)/i.test(projectViewRegression) && /select \* from finish\(\)/i.test(projectViewRegression), '50-assertion project-view pgTAP regression contract is required')
requireContract(/create table if not exists public\.atlas_initiatives/.test(migrationText), 'first-class ATLAS initiatives migration is required')
requireContract(/atlas_initiative_projects/.test(migrationText) && /atlas_initiative_relations/.test(migrationText), 'initiative project membership and multi-parent hierarchy are required')
requireContract(/set_atlas_initiative_parent/.test(migrationText) && /atlas_initiative_max_depth/.test(migrationText) && /atlas_initiative_cycle/.test(migrationText), 'initiative DAG cycle and five-level depth enforcement are required')
requireContract(/post_atlas_initiative_update/.test(migrationText) && /atlas_initiative_activity_log/.test(migrationText), 'structured initiative updates and audit history are required')
requireContract(/select plan\(72\)/i.test(initiativeRegression) && /select \* from finish\(\)/i.test(initiativeRegression), '72-assertion initiative pgTAP regression contract is required')
requireContract(/atlas_validate_initiative_resource_target/.test(migrationText), 'initiative resources require database-level safe target validation')
requireContract(/create table if not exists public\.atlas_templates/.test(migrationText) && /create table if not exists public\.atlas_template_instances/.test(migrationText), 'typed ATLAS templates and immutable instance provenance are required')
requireContract(/instantiate_atlas_template/.test(migrationText) && /atlas_template_form_field/.test(migrationText), 'transactional action, project, document, and form template instantiation is required')
requireContract(/create table if not exists public\.atlas_documents/.test(migrationText) && /atlas_document_versions/.test(migrationText), 'first-class versioned ATLAS documents are required')
requireContract(/select plan\(81\)/i.test(templateDocumentRegression) && /select \* from finish\(\)/i.test(templateDocumentRegression), '81-assertion template/document pgTAP regression contract is required')
requireContract(/create table if not exists public\.atlas_comments/.test(migrationText) && /create table if not exists public\.atlas_reactions/.test(migrationText), 'canonical Atlas comments and reactions are required')
requireContract(/resolve_atlas_comment_thread/.test(migrationText) && /resolution_comment_id/.test(migrationText), 'thread resolution with selected reply is required')
requireContract(/atlas_discussion_subscriptions/.test(migrationText) && /atlas_comment_anchor_invalid/.test(migrationText) && /atlas_comment_attachment_invalid/.test(migrationText), 'subscriptions, inline anchors, and attachment validation are required')
requireContract(/select plan\(83\)/i.test(collaborationRegression) && /select \* from finish\(\)/i.test(collaborationRegression), '83-assertion collaboration pgTAP regression contract is required')
requireContract(/create table if not exists public\.atlas_release_pipelines/.test(migrationText) && /create table if not exists public\.atlas_release_events/.test(migrationText), 'release pipelines and immutable CI events are required')
requireContract(/ingest_atlas_release_event/.test(migrationText) && /event_key/.test(migrationText) && /pg_advisory_xact_lock/.test(migrationText), 'idempotent serialized CI release ingestion is required')
requireContract(/atlas_release_stage_frozen/.test(migrationText) && /release_delivery/.test(migrationText) && /generate_atlas_release_notes/.test(migrationText), 'stage freeze, completion evidence, and release notes are required')
requireContract(/body\.status===['"]archived['"]&&getAuthKind\(c\)!==['"]owner_access['"]/.test(workerText), 'release archive must be owner-gated on the actual transition route')
requireContract(/select plan\(91\)/i.test(releasesRegression) && /select \* from finish\(\)/i.test(releasesRegression), '91-assertion releases pgTAP regression contract is required')
requireContract(/create table if not exists public\.atlas_insights/.test(migrationText) && /create table if not exists public\.atlas_dashboards/.test(migrationText), 'saved Insights and dashboards are required')
requireContract(/atlas_manage_action_lifecycle_timestamps/.test(migrationText) && /started_at/.test(migrationText) && /triaged_at/.test(migrationText), 'prospective analytics lifecycle timestamps are required')
requireContract(/atlas_insight_snapshots/.test(migrationText) && /atlas_export_receipts/.test(migrationText) && /content_sha256/.test(migrationText), 'immutable Insight snapshots and hashed export receipts are required')
requireContract(/select plan\(63\)/i.test(insightsExportsRegression) && /select \* from finish\(\)/i.test(insightsExportsRegression), '63-assertion Insights/export pgTAP regression contract is required')
requireContract(/create table if not exists public\.atlas_workflows/.test(migrationText) && /create table if not exists public\.atlas_workflow_statuses/.test(migrationText), 'business-scoped workflows and ordered statuses are required')
requireContract(/atlas_triage_entries/.test(migrationText) && /transition_atlas_triage_action/.test(migrationText), 'revisioned Triage decisions are required')
requireContract(/atlas_workflow_rules/.test(migrationText) && /record_atlas_workflow_rule_run/.test(migrationText) && /event_key/.test(migrationText), 'deterministic idempotent workflow-rule receipts are required')
requireContract(/apply_atlas_inactivity_action/.test(migrationText) && /atlas_inactivity_policy_runs/.test(migrationText), 'receipt-backed inactivity policy application is required')
requireContract(/atlas_triage_entries_canonical_action_idx/.test(migrationText) && /atlas_triage_events_action_idx/.test(migrationText) && /atlas_triage_settings_accept_status_idx/.test(migrationText), 'workflow foreign-key advisor corrections are required')
requireContract(/select plan\(101\)/i.test(workflowsTriageRegression) && /select \* from finish\(\)/i.test(workflowsTriageRegression), '101-assertion workflows/Triage pgTAP regression contract is required')
requireContract(/create table if not exists public\.atlas_notification_events/.test(migrationText) && /create table if not exists public\.atlas_notifications/.test(migrationText), 'canonical notification events and Inbox are required')
requireContract(/atlas_integration_connections/.test(migrationText) && /record_atlas_connection_verification/.test(migrationText) && /verified_endpoint_sha256/.test(migrationText), 'verified integration connection identity is required')
requireContract(/atlas_outbox_deliveries/.test(migrationText) && /claim_atlas_delivery/.test(migrationText) && /complete_atlas_delivery_attempt/.test(migrationText), 'idempotent retryable delivery outbox is required')
requireContract(/atlas_inbound_events/.test(migrationText) && /record_atlas_inbound_event/.test(migrationText) && /signature_verified/.test(migrationText), 'signed idempotent inbound staging is required')
requireContract(/atlas_outbox_deliveries_subscription_idx/.test(migrationText), 'outbox subscription foreign-key advisor correction is required')
requireContract(/select plan\(120\)/i.test(notificationsIntegrationsRegression) && /select \* from finish\(\)/i.test(notificationsIntegrationsRegression), '120-assertion notifications/integrations pgTAP regression contract is required')
requireContract(/create table if not exists public\.atlas_document_operations/.test(migrationText) && /create table if not exists public\.atlas_document_conflicts/.test(migrationText), 'canonical realtime document operation and conflict history are required')
requireContract(/apply_atlas_document_realtime_edit/.test(migrationText) && /record_atlas_document_conflict/.test(migrationText) && /revert_atlas_document_version/.test(migrationText), 'realtime edit, conflict, and revert RPCs are required')
requireContract(/name\s*=\s*["']DOCUMENT_ROOM["']/.test(wrangler) && /class_name\s*=\s*["']DocumentRoom["']/.test(wrangler) && /new_sqlite_classes\s*=\s*\[[^\]]*["']DocumentRoom["']/.test(wrangler), 'SQLite DocumentRoom Durable Object binding and forward migration are required')
requireContract(!/deleted_classes\s*=/.test(wrangler), 'Durable Object configuration must not delete classes')
requireContract(/select plan\(76\)/i.test(realtimeDocumentsRegression) && /select \* from finish\(\)/i.test(realtimeDocumentsRegression), '76-assertion realtime documents pgTAP regression contract is required')

requireContract(Boolean(migrationReconciliation), 'migration ledger reconciliation evidence is required')
if (migrationReconciliation) {
  const rows = Array.isArray(migrationReconciliation.migrations) ? migrationReconciliation.migrations : []
  const versions = new Set()
  for (const row of rows) {
    const file = typeof row.file === 'string' ? join(root, row.file) : ''
    requireContract(Boolean(file) && existsSync(file), `reconciled migration file is missing: ${row.file || 'unknown'}`)
    requireContract(typeof row.version === 'string' && !versions.has(row.version), `migration ledger version must be unique: ${row.version || 'unknown'}`)
    versions.add(row.version)
    if (file && existsSync(file)) {
      requireContract(row.file.split('/').pop().startsWith(`${row.version}_`), `migration filename must start with remote version ${row.version}`)
      requireContract(sha256(readFileSync(file)) === row.file_sha256, `migration file checksum drifted: ${row.file}`)
    }
  }
  requireContract(rows.length === 27 && migrationReconciliation.summary?.local_version_matches === 27, 'all 27 applied Atlas migration versions must be reconciled')
  requireContract(migrationReconciliation.summary?.unmatched_remote_versions === 0 && migrationReconciliation.summary?.unmatched_local_historical_versions === 0, 'migration reconciliation must have no unmatched historical versions')
  const rehearsal = migrationReconciliation.new_migration_rehearsal
  const newMigrationPath = rehearsal?.file ? join(root, rehearsal.file) : ''
  requireContract(Boolean(newMigrationPath) && existsSync(newMigrationPath), 'new initiative-resource safety migration is required')
  if (newMigrationPath && existsSync(newMigrationPath)) {
    requireContract(sha256(readFileSync(newMigrationPath)) === rehearsal.sha256, 'new initiative-resource safety migration checksum drifted')
  }
  requireContract(rehearsal?.remote_version === '20260821165622'
    && rehearsal?.remote_name === 'atlas_initiative_resource_safety'
    && rehearsal?.transaction === 'rollback-only-post-application'
    && rehearsal?.safe_https_insert === 'passed'
    && rehearsal?.unsafe_link_rejection === 'passed-sqlstate-22023'
    && rehearsal?.unsafe_document_rejection === 'passed-sqlstate-22023'
    && rehearsal?.post_rollback_function_count === 1
    && rehearsal?.post_rollback_trigger_count === 1
    && rehearsal?.post_rollback_test_rows === 0
    && rehearsal?.function_security_definer === false
    && rehearsal?.rls_enabled === true
    && rehearsal?.public_execute === false
    && rehearsal?.anon_execute === false
    && rehearsal?.authenticated_execute === false
    && rehearsal?.durable_application === true,
  'initiative-resource safety migration requires durable application, restricted authority, and successful rollback-only post-application verification')
}

if (failures.length) {
  console.error('ATLAS overhaul contract failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('ATLAS owner-only security and architecture contract passed.')
