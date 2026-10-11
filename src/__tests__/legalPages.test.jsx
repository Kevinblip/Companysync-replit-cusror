import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import PrivacyPolicy from '@/pages/PrivacyPolicy'
import TermsOfService from '@/pages/TermsOfService'

const require = createRequire(import.meta.url)
const legalPages = require('../lib/legalPages.cjs')

describe('legal page content (Google OAuth verification)', () => {
  it('includes company, contact, address, and last updated date', () => {
    expect(legalPages.COMPANY).toBe('CompanySync')
    expect(legalPages.CONTACT_EMAIL).toBe('yicnteam@gmail.com')
    expect(legalPages.ADDRESS_LINE).toMatch(/5420 Mardale Ave/)
    expect(legalPages.ADDRESS_LINE).toMatch(/Bedford Heights/)
    expect(legalPages.LAST_UPDATED).toBe('September 1, 2026')
  })

  it('documents Google Calendar scopes and limited use', () => {
    const html = legalPages.renderLegalHtml('privacy')
    expect(html).toContain('https://www.googleapis.com/auth/calendar')
    expect(html).toContain('https://www.googleapis.com/auth/calendar.events')
    expect(html).toMatch(/job appointments/i)
    expect(html).toMatch(/inspections/i)
    expect(html).toMatch(/crew schedules/i)
    expect(html).toMatch(/do not sell Google Calendar data/i)
    expect(html).toMatch(/disconnect/i)
    expect(html).toMatch(/Limited Use/i)
  })

  it('covers account data, CRM data, Google Sign-In, Stripe, cookies, retention, and deletion', () => {
    const html = legalPages.renderLegalHtml('privacy')
    expect(html).toMatch(/Account information/i)
    expect(html).toMatch(/Company and CRM data/i)
    expect(html).toMatch(/Google Sign-In/i)
    expect(html).toMatch(/Stripe/i)
    expect(html).toMatch(/session cookie/i)
    expect(html).toMatch(/Retention/i)
    expect(html).toMatch(/delete your account/i)
    expect(html).toMatch(/subprocessors/i)
  })

  it('renders a public HTML document without requiring login', () => {
    const html = legalPages.renderLegalHtml('privacy')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).not.toMatch(/Sign in to your account/)
    expect(html).not.toMatch(/Welcome Back/)
    expect(legalPages.matchLegalRoute('/privacy')).toBe('privacy')
    expect(legalPages.matchLegalRoute('/privacy-policy')).toBe('privacy')
    expect(legalPages.matchLegalRoute('/Privacy-Policy')).toBe('privacy')
    expect(legalPages.matchLegalRoute('/terms')).toBe('terms')
    expect(legalPages.matchLegalRoute('/login')).toBe(null)
  })

  it('includes short terms with the same contact', () => {
    const html = legalPages.renderLegalHtml('terms')
    expect(html).toMatch(/acceptable use/i)
    expect(html).toMatch(/Subscriptions and billing/i)
    expect(html).toContain('yicnteam@gmail.com')
    expect(html).toContain('September 1, 2026')
  })
})

describe('public legal React pages', () => {
  it('renders the privacy policy without a login form', () => {
    render(
      <MemoryRouter>
        <PrivacyPolicy />
      </MemoryRouter>
    )
    expect(screen.getByTestId('legal-page-privacy')).toBeInTheDocument()
    expect(screen.getByText(/CompanySync Privacy Policy/)).toBeInTheDocument()
    expect(screen.getByText(/Last updated September 1, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/https:\/\/www.googleapis.com\/auth\/calendar.events/)).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('input-login-email')).not.toBeInTheDocument()
  })

  it('renders terms of service', () => {
    render(
      <MemoryRouter>
        <TermsOfService />
      </MemoryRouter>
    )
    expect(screen.getByTestId('legal-page-terms')).toBeInTheDocument()
    expect(screen.getByText(/CompanySync Terms of Service/)).toBeInTheDocument()
    expect(screen.getByText(/acceptable use/i)).toBeInTheDocument()
  })
})
