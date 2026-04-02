import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ErrorBoundary from '@/components/ErrorBoundary'

function ThrowingComponent({ shouldThrow }) {
  if (shouldThrow) throw new Error('Test error')
  return <div data-testid="child-content">Working content</div>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    )
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument()
  })

  it('renders error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByTestId('error-boundary')).toBeInTheDocument()
    expect(screen.getByText('System Recovering')).toBeInTheDocument()
    expect(screen.getByText(/your data is safe/i)).toBeInTheDocument()
  })

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom error</div>}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument()
  })

  it('shows Go Home and Try Again buttons', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByTestId('button-error-go-home')).toBeInTheDocument()
    expect(screen.getByTestId('button-error-retry')).toBeInTheDocument()
  })

  it('resets error state when Try Again is clicked', () => {
    let shouldThrow = true
    function ConditionalThrow() {
      if (shouldThrow) throw new Error('Test error')
      return <div data-testid="recovered-content">Recovered</div>
    }

    render(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>
    )
    expect(screen.getByTestId('error-boundary')).toBeInTheDocument()

    shouldThrow = false
    fireEvent.click(screen.getByTestId('button-error-retry'))
    expect(screen.getByTestId('recovered-content')).toBeInTheDocument()
  })

  it('Go Home navigates to root', () => {
    const originalHref = window.location.href
    delete window.location
    window.location = { href: '' }

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    fireEvent.click(screen.getByTestId('button-error-go-home'))
    expect(window.location.href).toBe('/')

    window.location = { href: originalHref }
  })
})
