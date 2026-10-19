import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ErrorBoundary from '@/components/ErrorBoundary'
import HouseModel3D from './HouseModel3D'
import { footprintClassFor3D } from '@/utils/roof3DSourceSelection'

// Area 300 / bbox 400 = 0.75 → l-shape.
const lFootprint = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]]
const rectangleFootprint = [[0, 0], [30, 0], [30, 20], [0, 20]]

function BlockedModel({ footprintPolygon = lFootprint }) {
  const [presentationOverride, setPresentationOverride] = useState(false)
  return (
    <ErrorBoundary>
      <HouseModel3D
        presentationAllowed={false}
        presentationBlockReasons={['Wall review is incomplete.']}
        presentationOverride={presentationOverride}
        onPresentationOverride={() => setPresentationOverride(true)}
        footprintPolygon={footprintPolygon}
      />
    </ErrorBoundary>
  )
}

describe('HouseModel3D footprint classification', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('classifies an L outline and shows it in Build accuracy view', () => {
    render(<BlockedModel />)

    expect(screen.getByText('Present view is blocked for this measurement')).toBeInTheDocument()
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('button-show-build-accuracy'))

    const badge = screen.getByTestId('footprint-class-badge')
    const expected = footprintClassFor3D(lFootprint)
    expect(expected.type).toBe('l-shape')
    expect(badge).toHaveTextContent('l shape')
    expect(badge).toHaveAttribute(
      'title',
      expect.stringContaining(`L=${expected.L.toFixed(0)} W=${expected.W.toFixed(0)}`),
    )
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument()
    expect(screen.queryByText(/footprintClass is not defined/)).not.toBeInTheDocument()
  })

  it('keeps the page up when Show anyway reveals the estimator badge', () => {
    render(<BlockedModel />)

    fireEvent.click(screen.getByTestId('button-show-anyway-build-accuracy'))
    expect(screen.queryByTestId('presentation-blocked')).not.toBeInTheDocument()
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument()

    // Show anyway lifts the lock while the panel is still in customer view.
    // The footprint badge renders once the estimator view is opened.
    fireEvent.click(screen.getByTestId('button-toggle-presentation-view'))

    expect(screen.getByTestId('footprint-class-badge')).toHaveTextContent('l shape')
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument()
  })

  it('labels a filled rectangle instead of an L', () => {
    render(<BlockedModel footprintPolygon={rectangleFootprint} />)

    fireEvent.click(screen.getByTestId('button-show-build-accuracy'))

    const badge = screen.getByTestId('footprint-class-badge')
    expect(footprintClassFor3D(rectangleFootprint).type).toBe('rectangle')
    expect(badge).toHaveTextContent('rectangle')
    expect(badge).not.toHaveTextContent('l shape')
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument()
  })
})
