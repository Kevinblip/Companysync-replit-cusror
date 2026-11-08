import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APPROVED_PLAN_PRICE_IDS,
  APPROVED_PLAN_PRICES,
  NEW_COMPANY_TRIAL_DAYS,
  NEW_COMPANY_TRIAL_MS,
  NEW_TRIAL_CLAIM_SQL,
  applyCheckoutTrial,
  canInitializeTrial,
  evaluateVoiceTrialAccess,
  newCompanyTrialRecord,
  planCheckoutSessionCompleted,
  planSubscriptionCheckoutTrial,
  reduceTrialClaim,
} from './trialPolicy.js'

const NOW = new Date('2026-11-08T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function isoDaysFromNow(days) {
  return new Date(NOW.getTime() + days * DAY).toISOString()
}

describe('new company trial', () => {
  it('is exactly 14 days and does not require a card', () => {
    const trial = newCompanyTrialRecord(NOW)
    expect(trial.trialDays).toBe(14)
    expect(NEW_COMPANY_TRIAL_DAYS).toBe(14)
    expect(trial.requiresCard).toBe(false)
    expect(trial.subscription_status).toBe('trial')
    expect(trial.trial_ends_at).toBe(trial.trial_end_date)
    expect(new Date(trial.trial_ends_at).getTime() - NOW.getTime()).toBe(NEW_COMPANY_TRIAL_MS)
    expect(new Date(trial.trial_ends_at).getTime() - new Date(trial.startedAt).getTime()).toBe(14 * DAY)
  })

  it('initializes a blank company once and a retry keeps that timestamp', () => {
    const session = { mode: 'subscription', amount_total: 0, metadata: {} }
    const first = reduceTrialClaim({}, session, NOW)
    expect(first.claimed).toBe(true)
    expect(first.notify).toBe(true)
    expect(first.company.trial_ends_at).toBe(first.company.trial_end_date)
    expect(new Date(first.company.trial_ends_at).getTime() - NOW.getTime()).toBe(14 * DAY)

    const second = reduceTrialClaim(first.company, session, new Date(NOW.getTime() + DAY))
    expect(second.claimed).toBe(false)
    expect(second.notify).toBe(false)
    expect(second.company.trial_ends_at).toBe(first.company.trial_ends_at)
    expect(second.company.trial_end_date).toBe(first.company.trial_end_date)
    expect(second.company.subscription_status).toBe('trial')
  })
})

describe('stored trial ends and subscriptions', () => {
  it('preserves a 30-day promised end', () => {
    const end = isoDaysFromNow(30)
    const company = { subscription_status: 'trial', trial_ends_at: end, trial_end_date: end }
    const checkout = planSubscriptionCheckoutTrial(company, { extend_trial: '7' }, NOW)
    expect(checkout.action).toBe('preserve_stored_end')
    expect(checkout.trial_period_days).toBeNull()
    expect(checkout.trial_end).toBe(Math.floor(new Date(end).getTime() / 1000))
    expect(checkout.storedTrialEnd).toBe(end)

    const webhook = planCheckoutSessionCompleted({
      company,
      session: { mode: 'subscription', amount_total: 0, metadata: {} },
      now: NOW,
    })
    expect(webhook.update).toBeNull()
    expect(webhook.notify).toBe(false)
    expect(webhook.trialEnd).toBe(end)
    expect(canInitializeTrial(company)).toBe(false)
  })

  it('preserves a 21-day bonus end', () => {
    const end = isoDaysFromNow(21)
    const company = {
      subscription_status: 'trial',
      data: { trial_ends_at: end, trial_end_date: end },
    }
    const checkout = planSubscriptionCheckoutTrial(company, { extend_trial: '7' }, NOW)
    expect(checkout.storedTrialEnd).toBe(end)
    expect(checkout.trial_period_days).toBeNull()
    const webhook = planCheckoutSessionCompleted({
      company,
      session: { mode: 'subscription', amount_total: 0, metadata: { extend_trial: '7' } },
      now: NOW,
    })
    expect(webhook.update).toBeNull()
    expect(webhook.trialEnd).toBe(end)
  })

  it('preserves an already-expired end', () => {
    const end = isoDaysFromNow(-5)
    const company = { subscription_status: 'trial', trial_end_date: end }
    const checkout = planSubscriptionCheckoutTrial(company, {}, NOW)
    expect(checkout.action).toBe('preserve_expired_end')
    expect(checkout.trial_period_days).toBeNull()
    expect(checkout.trial_end).toBeNull()
    expect(checkout.storedTrialEnd).toBe(end)
    const webhook = planCheckoutSessionCompleted({
      company,
      session: { mode: 'subscription', amount_total: 0, metadata: {} },
      now: NOW,
    })
    expect(webhook.update).toBeNull()
    expect(webhook.trialEnd).toBe(end)
  })

  it('does not grant or reset a trial for an active or cancelled subscription', () => {
    for (const status of ['active', 'cancelled', 'past_due']) {
      const company = {
        subscription_status: status,
        stripe_subscription_id: 'sub_existing',
        subscription_plan: 'business',
      }
      const checkout = planSubscriptionCheckoutTrial(company, { extend_trial: '7' }, NOW)
      expect(checkout.trial_period_days).toBeNull()
      expect(checkout.trial_end).toBeNull()
      expect(checkout.action).toBe('no_trial_on_existing_subscription')
      const webhook = planCheckoutSessionCompleted({
        company,
        session: { mode: 'subscription', amount_total: 0, metadata: {} },
        now: NOW,
      })
      expect(webhook.update).toBeNull()
      expect(webhook.notify).toBe(false)
    }
  })

  it('does not turn a paid checkout into a 14-day trial', () => {
    const decision = planCheckoutSessionCompleted({
      company: {},
      session: { mode: 'subscription', amount_total: 9900, metadata: { plan_name: 'Basic' } },
      now: NOW,
    })
    expect(decision.action).toBe('paid_checkout_preserve')
    expect(decision.update).toBeNull()
    expect(decision.notify).toBe(false)
  })

  it('leaves credit purchases off the trial clock', () => {
    const end = isoDaysFromNow(30)
    const decision = planCheckoutSessionCompleted({
      company: { subscription_status: 'active', trial_ends_at: end },
      session: {
        mode: 'payment',
        amount_total: 2500,
        metadata: { purchase_type: 'credits', credits: '500' },
      },
      now: NOW,
    })
    expect(decision.action).toBe('credits_unchanged')
    expect(decision.update).toBeNull()
    expect(decision.trialEnd).toBe(end)
  })

  it('keeps the pre-existing 21-day card offer only when no end is stored', () => {
    const fresh = planSubscriptionCheckoutTrial({}, { extend_trial: '7' }, NOW)
    expect(fresh.action).toBe('existing_card_bonus_offer')
    expect(fresh.trial_period_days).toBe(21)
    expect(fresh.trial_end).toBeNull()

    const config = applyCheckoutTrial({ subscription_data: { metadata: {} } }, fresh)
    expect(config.subscription_data.trial_period_days).toBe(21)
    expect(config.subscription_data.trial_end).toBeUndefined()
    expect(config.subscription_data.metadata.bonus_days_applied).toBe('7')

    const plain = planSubscriptionCheckoutTrial({}, {}, NOW)
    expect(plain.trial_period_days).toBe(14)
    const plainConfig = applyCheckoutTrial({ subscription_data: { metadata: {} } }, plain)
    expect(plainConfig.subscription_data.trial_period_days).toBe(14)
    expect(plainConfig.subscription_data.metadata.bonus_days_applied).toBe('0')
  })
})

describe('voice access', () => {
  it('blocks an expired trial and allows a future one', () => {
    expect(evaluateVoiceTrialAccess({
      subscription_plan: 'trial',
      subscription_status: 'trial',
      trial_end_date: isoDaysFromNow(-1),
    }, NOW).allowed).toBe(false)

    expect(evaluateVoiceTrialAccess({
      subscription_plan: 'professional',
      data: { subscription_status: 'trial', trial_ends_at: isoDaysFromNow(-2) },
    }, NOW).allowed).toBe(false)

    expect(evaluateVoiceTrialAccess({
      subscription_plan: 'professional',
      subscription_status: 'trial',
      trial_ends_at: isoDaysFromNow(30),
    }, NOW).allowed).toBe(true)
  })

  it('does not block a company that already has a Stripe subscription', () => {
    const access = evaluateVoiceTrialAccess({
      subscription_plan: 'trial',
      subscription_status: 'trial',
      stripe_subscription_id: 'sub_paid',
      trial_end_date: isoDaysFromNow(-10),
    }, NOW)
    expect(access.allowed).toBe(true)
  })

  it('still blocks cancelled and suspended companies', () => {
    expect(evaluateVoiceTrialAccess({ subscription_status: 'cancelled' }, NOW).allowed).toBe(false)
    expect(evaluateVoiceTrialAccess({
      subscription_status: 'suspended',
      stripe_subscription_id: 'sub_paid',
    }, NOW).allowed).toBe(false)
  })
})

describe('claim sql and unchanged billing links', () => {
  it('claims only a row with no end, status, subscription, or paid plan', () => {
    expect(NEW_TRIAL_CLAIM_SQL).toContain('trial_end_date IS NULL')
    expect(NEW_TRIAL_CLAIM_SQL).toContain("COALESCE(data->>'trial_ends_at', '') = ''")
    expect(NEW_TRIAL_CLAIM_SQL).toContain("COALESCE(subscription_status, '') = ''")
    expect(NEW_TRIAL_CLAIM_SQL).toContain("COALESCE(stripe_subscription_id, '') = ''")
    expect(NEW_TRIAL_CLAIM_SQL).toContain("'professional'")
    expect(NEW_TRIAL_CLAIM_SQL).not.toMatch(/UPDATE companies(?![\s\S]*WHERE)/)
  })

  it('keeps the approved $99/$199/$399 plans and Stripe price ids', () => {
    const pricing = readFileSync(path.join(process.cwd(), 'src/pages/Pricing.jsx'), 'utf8')
    const publicPricing = readFileSync(path.join(process.cwd(), 'src/pages/PublicPricing.jsx'), 'utf8')
    for (const source of [pricing, publicPricing]) {
      expect(source).toContain(`price: ${APPROVED_PLAN_PRICES.basic}`)
      expect(source).toContain(`price: ${APPROVED_PLAN_PRICES.business}`)
      expect(source).toContain(`price: ${APPROVED_PLAN_PRICES.enterprise}`)
      expect(source).toContain(APPROVED_PLAN_PRICE_IDS.basic)
      expect(source).toContain(APPROVED_PLAN_PRICE_IDS.business)
      expect(source).toContain(APPROVED_PLAN_PRICE_IDS.enterprise)
      expect(source).not.toContain('price: 59')
      expect(source).not.toContain('price: 149')
      expect(source).not.toContain('price: 299')
    }
  })

  it('keeps signup and pricing trial copy on 14 days without a card', () => {
    const signup = readFileSync(path.join(process.cwd(), 'src/pages/SignupPage.jsx'), 'utf8')
    const pricing = readFileSync(path.join(process.cwd(), 'src/pages/Pricing.jsx'), 'utf8')
    const publicPricing = readFileSync(path.join(process.cwd(), 'src/pages/PublicPricing.jsx'), 'utf8')
    expect(signup).toContain('14 days free, no credit card required')
    expect(pricing).toContain('14-day free trial')
    expect(pricing).toContain('No credit card required')
    expect(publicPricing).toContain('14-day free trial • No credit card required • Cancel anytime')
    expect(publicPricing).toContain('No credit card needed')
  })

  it('does not replace client-priced credit checkout with a new catalog', () => {
    const purchase = readFileSync(path.join(process.cwd(), 'functions/purchaseCredits.ts'), 'utf8')
    const stripePlugin = readFileSync(path.join(process.cwd(), 'vite-stripe-plugin.js'), 'utf8')
    expect(purchase).toContain('unit_amount: amount * 100')
    expect(purchase).toContain('purchase_type: \'credits\'')
    expect(stripePlugin).toContain('unit_amount: amount * 100')
    expect(stripePlugin).toContain("purchase_type: 'credits'")
    expect(purchase).not.toContain('price_1T4Q')
  })
})
