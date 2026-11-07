import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PhotoSlotGuide, photoSlotHint } from './PhotoSlotGuide'

describe('photo slot orientation guide', () => {
  it('shows the street-facing left/right hint and the house diagram', () => {
    render(<PhotoSlotGuide />)
    const guide = screen.getByTestId('photo-slot-orientation-guide')
    expect(guide.textContent).toMatch(/from the street/i)
    expect(guide.textContent).toMatch(/Back Right is on your left/i)
    expect(guide.querySelector('svg')).toBeTruthy()
  })

  it('names Back Right from the street, not from behind the house', () => {
    expect(photoSlotHint('BR Corner')).toMatch(/your left from behind/i)
    expect(photoSlotHint('Left Side')).toMatch(/from the street/i)
    expect(photoSlotHint('Right Side')).toMatch(/from the street/i)
  })
})
