import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InteractiveRoofMap from './InteractiveRoofMap'
import { installMockGoogleMaps } from '@/dev/mockGoogleMaps'

const LAT = 41.3828633
const LNG = -81.5607747
const FEET_PER_LAT = 111320 * 3.28084
const FEET_PER_LNG = FEET_PER_LAT * Math.cos((LAT * Math.PI) / 180)

function at(eastFt, northFt) {
  return {
    lat: LAT + northFt / FEET_PER_LAT,
    lng: LNG + eastFt / FEET_PER_LNG,
  }
}

function clickMap(api, eastFt, northFt) {
  const point = at(eastFt, northFt)
  act(() => api.fireMapClick(point.lat, point.lng))
}

function dblClickMap(api, eastFt, northFt) {
  const point = at(eastFt, northFt)
  act(() => api.fireMapDblClick(point.lat, point.lng))
}

function renderMap(props = {}) {
  const api = installMockGoogleMaps({ zoom: 20, center: { lat: LAT, lng: LNG } })
  const view = render(
    <InteractiveRoofMap
      latitude={LAT}
      longitude={LNG}
      address="38 South Cir, Bedford OH"
      googleMapsLoaded
      onMeasurementsComplete={() => {}}
      onBack={() => {}}
      {...props}
    />,
  )
  return { ...view, api }
}

function usedLength(type) {
  const card = screen.getByTestId(`edge-total-${type}`)
  return Number(card.textContent.match(/([\d.]+)\s*LF/)[1])
}

function mappedPolylines(api, length) {
  return api.shapes.polylines.filter((line) => line.getMap() && line.getPath().getLength() === length)
}

async function drawRing(api, corners) {
  for (const [east, north] of corners) clickMap(api, east, north)
  fireEvent.click(screen.getByTestId('btn-finish-drawing'))
  await waitFor(() => expect(screen.getByTestId('btn-finish-drawing')).toBeInTheDocument())
}

describe('manual roof trace multi-facet drawing', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('draws two facets, snaps the shared ridge, and totals both planes', async () => {
    const { api } = renderMap()
    fireEvent.click(await screen.findByTestId('draw-roof-outline'))

    clickMap(api, -20, -15)
    clickMap(api, 20, -15)
    clickMap(api, 20, 0)
    expect(screen.getByTestId('drawing-point-count').textContent).toMatch(/3 points/)
    fireEvent.click(screen.getByTestId('button-undo-point'))
    expect(screen.getByTestId('drawing-point-count').textContent).toMatch(/2 points/)
    // Re-place the undone corner immediately. Undo must not look like a double-tap.
    clickMap(api, 20, 0)
    clickMap(api, -20, 0)
    expect(screen.getByTestId('drawing-point-count').textContent).toMatch(/4 points/)
    fireEvent.click(screen.getByTestId('btn-finish-drawing'))

    await screen.findByTestId('facet-tab-2')
    expect(screen.getByTestId('draw-roof-outline').textContent).toMatch(/Facet 2/)

    // Three feet off the shared northwest corner. Snapping should land on it.
    clickMap(api, -20, 3)
    clickMap(api, 20, 0)
    clickMap(api, 20, 15)
    clickMap(api, -20, 15)
    fireEvent.click(screen.getByTestId('btn-finish-drawing'))

    await screen.findByTestId('facet-summary-2')
    const totals = screen.getByTestId('trace-edge-totals')
    const ridge = within(totals).getByText('Ridge').parentElement.textContent
    const eave = within(totals).getByText('Eave').parentElement.textContent
    const hip = within(totals).getByText('Hip').parentElement.textContent
    expect(Number(ridge.match(/[\d.]+/)[0])).toBeGreaterThan(35)
    expect(Number(eave.match(/[\d.]+/)[0])).toBeGreaterThan(70)
    expect(Number(hip.match(/[\d.]+/)[0])).toBeLessThan(1)
    expect(screen.getByTestId('manual-trace-topology-status').textContent).toMatch(/closed/i)
    expect(screen.getByTestId('facet-summary-1').textContent).toMatch(/SQ/)
    expect(screen.getByTestId('facet-summary-2').textContent).toMatch(/SQ/)

    const saved = api.shapes.polygons.filter((poly) => poly._map && poly.getPath().getLength() >= 3)
    const snappedStart = saved.some((poly) => {
      const first = poly.getPath().getAt(0)
      return Math.abs(first.lat() - at(-20, 0).lat) < 1e-8
        && Math.abs(first.lng() - at(-20, 0).lng) < 1e-8
    })
    expect(snappedStart).toBe(true)

    fireEvent.change(screen.getByTestId('input-active-facet-name'), { target: { value: 'East plane' } })
    expect(screen.getByTestId('facet-tab-3').textContent).toMatch(/East plane/)
  })

  it('adds, renames, and deletes a facet from the list', async () => {
    renderMap()
    fireEvent.click(await screen.findByTestId('button-add-facet'))
    const second = await screen.findByTestId('facet-tab-2')
    expect(second).toHaveAttribute('aria-selected', 'true')
    fireEvent.change(screen.getByTestId('input-active-facet-name'), { target: { value: 'Garage' } })
    expect(screen.getByTestId('facet-tab-2').textContent).toMatch(/Garage/)
    fireEvent.change(screen.getByTestId('input-active-facet-pitch'), { target: { value: '8/12' } })
    expect(screen.getByTestId('input-active-facet-pitch')).toHaveValue('8/12')
    fireEvent.change(screen.getByTestId('select-active-facet-direction'), { target: { value: '90' } })
    expect(screen.getByTestId('select-active-facet-direction')).toHaveValue('90')
    fireEvent.click(screen.getByTestId('button-delete-active-facet'))
    await waitFor(() => expect(screen.queryByTestId('facet-tab-2')).not.toBeInTheDocument())
    expect(screen.getByTestId('facet-tab-1')).toBeInTheDocument()
  })

  it('drags a finished corner to a new position', async () => {
    const { api } = renderMap()
    fireEvent.click(await screen.findByTestId('draw-roof-outline'))
    await drawRing(api, [[-20, -15], [20, -15], [20, 0], [-20, 0]])
    const handle = api.shapes.markers.find((marker) => marker._title === 'Drag to move this corner' && marker._map)
    expect(handle).toBeTruthy()
    const moved = at(-20, -12)
    const drag = new api.LatLng(moved.lat, moved.lng)
    act(() => {
      handle.__listeners.drag.forEach((fn) => fn({ latLng: drag }))
      handle.__listeners.dragend.forEach((fn) => fn())
    })
    const polygons = api.shapes.polygons.filter((poly) => poly._map && poly.getPath().getLength() === 4)
    const movedCorner = polygons.some((poly) => {
      for (let i = 0; i < poly.getPath().getLength(); i++) {
        const p = poly.getPath().getAt(i)
        if (Math.abs(p.lat() - moved.lat) < 1e-8 && Math.abs(p.lng() - moved.lng) < 1e-8) return true
      }
      return false
    })
    expect(movedCorner).toBe(true)
  })

  it('finishes a facet on double-click without an extra vertex or a zoom', async () => {
    const { api } = renderMap()
    const map = api.getMap()
    const zoomBefore = map.getZoom()
    act(() => api.fireMapDblClick(LAT, LNG))
    expect(map.getZoom()).toBe(zoomBefore + 1)
    expect(map._disableDoubleClickZoom).toBe(false)

    fireEvent.click(await screen.findByTestId('draw-roof-outline'))
    expect(map._disableDoubleClickZoom).toBe(true)
    const zoomWhileDrawing = map.getZoom()

    clickMap(api, -20, -15)
    clickMap(api, 20, -15)
    clickMap(api, 20, 0)
    // Both clicks of the double-click land as vertices. They are far enough
    // apart to miss the same-spot double-tap, and close enough that the
    // finish gesture must take both back.
    clickMap(api, -20, 0)
    clickMap(api, -20, 6)
    expect(screen.getByTestId('drawing-point-count').textContent).toMatch(/5 points/)

    dblClickMap(api, -20, 6)
    expect(map.getZoom()).toBe(zoomWhileDrawing)

    await screen.findByTestId('facet-tab-2')
    const finished = api.shapes.polygons.filter((poly) => poly.getMap() && poly.getPath().getLength() === 3)
    expect(finished).toHaveLength(1)
    const path = finished[0].getPath()
    const corners = [0, 1, 2].map((i) => ({ lat: path.getAt(i).lat(), lng: path.getAt(i).lng() }))
    const hasPoint = (east, north) => corners.some((corner) => {
      const point = at(east, north)
      return Math.abs(corner.lat - point.lat) < 1e-8 && Math.abs(corner.lng - point.lng) < 1e-8
    })
    expect(hasPoint(-20, -15)).toBe(true)
    expect(hasPoint(20, -15)).toBe(true)
    expect(hasPoint(20, 0)).toBe(true)
    expect(hasPoint(-20, 0)).toBe(false)
    expect(hasPoint(-20, 6)).toBe(false)
  })

  it('finishes a line on double-click and still finishes one with Done', async () => {
    const { api } = renderMap()
    const map = api.getMap()
    fireEvent.click(await screen.findByTestId('draw-ridge'))
    expect(map._disableDoubleClickZoom).toBe(true)
    const zoomWhileDrawing = map.getZoom()

    clickMap(api, -10, 40)
    clickMap(api, 10, 40)
    clickMap(api, 10, 55)
    clickMap(api, 10, 61)
    expect(screen.getByTestId('drawing-line-status').textContent).toMatch(/4 points/)

    dblClickMap(api, 10, 61)
    expect(map.getZoom()).toBe(zoomWhileDrawing)
    await screen.findByTestId('manual-line-length')
    const doubled = mappedPolylines(api, 2)
    expect(doubled).toHaveLength(1)
    expect(screen.getByTestId('manual-line-length').textContent).toMatch(/20\.0 ft/)
    expect(doubled[0].getPath().getLength()).toBe(2)

    fireEvent.click(screen.getByTestId('draw-rake'))
    clickMap(api, -10, 70)
    clickMap(api, 15, 70)
    expect(screen.getByTestId('drawing-line-status').textContent).toMatch(/2 points/)
    fireEvent.click(screen.getByTestId('btn-finish-line-drawing'))
    await waitFor(() => expect(screen.getAllByTestId('manual-line-length')).toHaveLength(2))
    expect(mappedPolylines(api, 2)).toHaveLength(2)
    expect(screen.getAllByTestId('manual-line-length')[1].textContent).toMatch(/25\.0 ft/)
  })

  it('saves an open facet and lets a drawn ridge replace the traced length', async () => {
    const onMeasurementsComplete = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { api } = renderMap({ onMeasurementsComplete })
    fireEvent.click(await screen.findByTestId('draw-roof-outline'))
    await drawRing(api, [[-20, -15], [20, -15], [20, 0], [-20, 0]])

    const save = await screen.findByTestId('save-measurements')
    expect(save).toBeEnabled()
    expect(screen.getByTestId('save-open-edge-note')).toBeInTheDocument()
    const tracedRidge = usedLength('ridge')
    expect(tracedRidge).toBeGreaterThan(35)

    fireEvent.click(screen.getByTestId('draw-ridge'))
    clickMap(api, -10, 40)
    clickMap(api, 10, 40)
    fireEvent.click(screen.getByTestId('btn-finish-line-drawing'))
    await screen.findByTestId('manual-line-length')

    expect(usedLength('ridge')).toBeCloseTo(20, 0)
    expect(screen.getByTestId('edge-total-ridge').textContent).toMatch(/replaces/)
    expect(usedLength('drip_edge')).toBeCloseTo(usedLength('eave') + usedLength('rake'), 0)

    fireEvent.click(screen.getByTestId('save-measurements'))
    expect(confirm).toHaveBeenCalled()
    expect(onMeasurementsComplete).toHaveBeenCalledTimes(1)
    const payload = onMeasurementsComplete.mock.calls[0][0]
    expect(payload.corrected_area_sq).toBeGreaterThan(5)
    expect(payload.sections.some((section) => section.area_sqft > 500)).toBe(true)
    expect(payload.ridge_lf).toBeCloseTo(20, 0)
    expect(payload.eave_lf).toBeGreaterThan(30)
    expect(payload.manual_lines).toEqual([
      expect.objectContaining({ type: 'ridge', length_ft: expect.closeTo(20, 0) }),
    ])
    expect(payload.drip_edge_source).toBe('eave_plus_rake')
    expect(payload.drip_edge_lf).toBeCloseTo(payload.eave_lf + payload.rake_lf, 1)

    fireEvent.click(screen.getByTestId('button-delete-line'))
    await waitFor(() => expect(screen.queryByTestId('manual-line-length')).not.toBeInTheDocument())
    expect(usedLength('ridge')).toBeCloseTo(tracedRidge, 0)
    confirm.mockRestore()
  })
})
