import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

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

requireContract(!existsSync(join(root, 'app/server')), 'duplicate Express backend app/server must be removed')
requireContract(!/\.from\(['"]atlas_actions['"]\)\s*\.delete\s*\(/s.test(workerText), 'Worker must not hard-delete atlas_actions')
requireContract(!/\.from\(['"]atlas_activity_log['"]\)\s*\.delete\s*\(/s.test(workerText), 'Worker must not delete atlas_activity_log')
requireContract(!/router\.delete\s*\(/.test(workerText) || /HARD_DELETE_DISABLED/.test(workerText), 'any DELETE compatibility route must return the hard-delete-disabled contract')
requireContract(!/runAutomationJob|runScheduledProtocolJobs|\bscheduled\s*\(/.test(workerText), 'Worker must not execute automations')
requireContract(!/^\s*\[triggers\]/m.test(wrangler) && !/\bcrons\s*=/.test(wrangler), 'Worker cron triggers must be absent')
requireContract(!/\bnicole\b/i.test(appText), 'active UI must not expose Nicole')
requireContract(/ATLAS_OWNER_EMAILS/.test(workerText), 'Worker must enforce an owner email allowlist')
requireContract(/ATLAS_API_PRINCIPALS_JSON/.test(workerText), 'Worker must use scoped machine principals')
requireContract(/codex/.test(workerText) && /claude/.test(workerText) && /ransomed/.test(workerText), 'the three canonical principals must be represented')
requireContract(/PRINCIPAL_ROSTER_FIXED/.test(workerText), 'the API must reject creation of additional principals')
requireContract(/revoke[\s\S]*function/.test(migrationText), 'migrations must revoke privileged function execution')
requireContract(/prevent[\s\S]*delete|delete[\s\S]*forbidden|raise exception[\s\S]*delete/.test(migrationText), 'migrations must guard destructive deletion')
requireContract(/complete_atlas_action/.test(migrationText), 'atomic completion RPC migration is required')
requireContract(/archive_atlas_action/.test(migrationText), 'atomic archive RPC migration is required')
requireContract(/restore_atlas_action/.test(migrationText), 'atomic restore RPC migration is required')
requireContract(/select plan\(46\)/i.test(databaseRegression) && /select \* from finish\(\)/i.test(databaseRegression), '46-assertion pgTAP regression contract is required')

if (failures.length) {
  console.error('ATLAS overhaul contract failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('ATLAS owner-only security and architecture contract passed.')
