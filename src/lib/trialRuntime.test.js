import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  applyCheckoutTrial,
  newCompanyTrialRecord,
  planSubscriptionCheckoutTrial,
} from './trialPolicy.js'

const root = process.cwd()
const NOW = new Date('2026-11-08T12:00:00.000Z')
const STANDALONE_FUNCTIONS = [
  'functions/createCheckoutSession.ts',
  'functions/autoSignupFromMarketing.ts',
  'functions/autoSetupCompany.ts',
]

function embeddedPolicy(file) {
  const source = readFileSync(path.join(root, file), 'utf8')
  const match = source.match(/\/\* TRIAL_POLICY_START \*\/([\s\S]*?)\/\* TRIAL_POLICY_END \*\//)
  expect(match, file).toBeTruthy()
  return match[1]
}

function loadEmbedded(source) {
  const context = {}
  vm.runInNewContext(`${source}\nglobalThis.__trial = { newCompanyTrialRecord, planSubscriptionCheckoutTrial, applyCheckoutTrial };`, context)
  return context.__trial
}

describe('Base44 functions do not import the unbundled helper', () => {
  it('inlines one policy and does not import src/lib or a sibling module', () => {
    const blocks = STANDALONE_FUNCTIONS.map(embeddedPolicy)
    expect(new Set(blocks).size).toBe(1)
    for (const file of STANDALONE_FUNCTIONS) {
      const source = readFileSync(path.join(root, file), 'utf8')
      expect(source).not.toMatch(/from ['"][^'"]*src\/lib/)
      expect(source).not.toMatch(/from ['"]\.\.?\/trialPolicy/)
      expect(source).not.toMatch(/from ['"]\.\//)
    }
    const webhook = readFileSync(path.join(root, 'functions/stripeWebhook.ts'), 'utf8')
    expect(webhook).toContain('TRIAL_DATES_NOT_MODIFIED')
    expect(webhook).not.toMatch(/from ['"][^'"]*trialPolicy/)
    expect(webhook).not.toContain('trial_ends_at')
    const nonCreditCheckout = webhook.split('TRIAL_DATES_NOT_MODIFIED')[1].split("case 'customer.subscription.created'")[0]
    expect(nonCreditCheckout).not.toContain('Company.update')
    expect(nonCreditCheckout).not.toContain('SendEmail')
  })

  it('runs the inlined policy and matches the Node module', () => {
    const embedded = loadEmbedded(embeddedPolicy(STANDALONE_FUNCTIONS[0]))
    const canonical = newCompanyTrialRecord(NOW)
    const standalone = embedded.newCompanyTrialRecord(NOW)
    expect(standalone).toEqual(canonical)

    const company = { subscription_status: 'trial', trial_ends_at: canonical.trial_ends_at }
    const nodeCheckout = planSubscriptionCheckoutTrial(company, { extend_trial: '7' }, NOW)
    const fileCheckout = embedded.planSubscriptionCheckoutTrial(company, { extend_trial: '7' }, NOW)
    expect(fileCheckout).toEqual(nodeCheckout)

    const paid = { subscription_status: 'active', stripe_subscription_id: 'sub_123', subscription_plan: 'business' }
    expect(embedded.planSubscriptionCheckoutTrial(paid, { extend_trial: '7' }, NOW).trial_period_days).toBeNull()
    expect(embedded.applyCheckoutTrial({ subscription_data: { metadata: {} } }, embedded.planSubscriptionCheckoutTrial({}, {}, NOW)).subscription_data.trial_period_days).toBe(14)
    expect(applyCheckoutTrial({ subscription_data: { metadata: {} } }, planSubscriptionCheckoutTrial({}, {}, NOW)).subscription_data.trial_period_days).toBe(14)
  })
})

describe('Node entrypoints resolve the trial module from their runtime paths', () => {
  const entrypoints = [
    ['prod-server.cjs', './src/lib/trialPolicy.js'],
    ['db/local-auth.cjs', '../src/lib/trialPolicy.js'],
    ['db/prod-db.cjs', '../src/lib/trialPolicy.js'],
    ['vite-stripe-plugin.js', './src/lib/trialPolicy.js'],
    ['vite-db-plugin.js', './src/lib/trialPolicy.js'],
    ['vite-twilio-ws-plugin.js', './src/lib/trialPolicy.js'],
  ]

  it('points every server import at a file that loads', async () => {
    for (const [file, specifier] of entrypoints) {
      const source = readFileSync(path.join(root, file), 'utf8')
      expect(source).toContain(specifier)
      const resolved = path.resolve(path.dirname(path.join(root, file)), specifier)
      expect(resolved.endsWith(`${path.sep}src${path.sep}lib${path.sep}trialPolicy.js`)).toBe(true)
      const loaded = await import(pathToFileURL(resolved).href)
      expect(loaded.newCompanyTrialRecord).toBeTypeOf('function')
      expect(loaded.insertNewCompanyTrial).toBeTypeOf('function')
    }
  })

  it('loads the module from a dist layout using the production specifier', async () => {
    const tmp = mkdtempSync(path.join(root, '.tmp-dist-trial-'))
    try {
      mkdirSync(path.join(tmp, 'src', 'lib'), { recursive: true })
      const policy = readFileSync(path.join(root, 'src/lib/trialPolicy.js'), 'utf8')
      writeFileSync(path.join(tmp, 'src/lib/trialPolicy.js'), policy)
      writeFileSync(path.join(tmp, 'index.cjs'), 'module.exports = import("./src/lib/trialPolicy.js");\n')
      const require = createRequire(path.join(root, 'package.json'))
      const loaded = await require(path.join(tmp, 'index.cjs'))
      const trial = loaded.newCompanyTrialRecord(NOW)
      expect(new Date(trial.trial_ends_at).getTime() - NOW.getTime()).toBe(14 * 24 * 60 * 60 * 1000)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('syntax-checks the edited server entrypoints', () => {
    for (const file of ['prod-server.cjs', 'db/local-auth.cjs', 'db/prod-db.cjs', 'vite-stripe-plugin.js', 'vite-db-plugin.js', 'vite-twilio-ws-plugin.js']) {
      execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' })
    }
    const voiceSelect = readFileSync(path.join(root, 'vite-twilio-ws-plugin.js'), 'utf8')
    const prodSelect = readFileSync(path.join(root, 'prod-server.cjs'), 'utf8')
    for (const source of [voiceSelect, prodSelect]) {
      expect(source).not.toContain('subscription_plan, subscription_status, trial_end_date')
      expect(source).toContain('subscription_plan, trial_end_date, stripe_subscription_id, data')
    }
  })
})
