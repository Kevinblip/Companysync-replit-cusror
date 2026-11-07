import { describe, expect, it } from 'vitest'
import { buildTracedRoofGraph } from '../../functions/utils/roofTracedFacetGraph.js'
import {
  estimateDripEdgeLf,
  findSnapTarget,
  planNextFacet,
  resolveEdgeTotals,
  sumFacetEdgeLengths,
} from './roofTraceSession'

const PITCH_4_12 = Math.atan(4 / 12) * 180 / Math.PI
const SLOPE_4_12 = 1 / Math.cos(PITCH_4_12 * Math.PI / 180)

describe('4-facet hip roof topology', () => {
  it('reports slope-corrected hips, full eaves, a level ridge, and the pitched area', () => {
    // 40 ft east-west by 30 ft north-south, 10 ft ridge, every plane 4/12.
    const hip = buildTracedRoofGraph({
      facets: [
        { id: 'south', azimuth_degrees: 180, pitch_degrees: PITCH_4_12,
          polygon: [{ x: -20, y: -15 }, { x: 20, y: -15 }, { x: 5, y: 0 }, { x: -5, y: 0 }] },
        { id: 'north', azimuth_degrees: 0, pitch_degrees: PITCH_4_12,
          polygon: [{ x: -20, y: 15 }, { x: -5, y: 0 }, { x: 5, y: 0 }, { x: 20, y: 15 }] },
        { id: 'east', azimuth_degrees: 90, pitch_degrees: PITCH_4_12,
          polygon: [{ x: 20, y: -15 }, { x: 20, y: 15 }, { x: 5, y: 0 }] },
        { id: 'west', azimuth_degrees: 270, pitch_degrees: PITCH_4_12,
          polygon: [{ x: -20, y: -15 }, { x: -5, y: 0 }, { x: -20, y: 15 }] },
      ],
      weldToleranceFt: 1.5,
    })

    expect(hip.totals.facet_count).toBe(4)
    expect(hip.totals.open_boundary_count).toBe(0)
    expect(hip.edge_totals.ridge).toBeCloseTo(10, 0)
    expect(hip.edge_totals.eave).toBeCloseTo(140, 0)
    expect(hip.edge_totals.rake).toBeCloseTo(0, 1)
    expect(hip.edge_totals.valley).toBeCloseTo(0, 1)
    // Each hip runs 21.21 ft in plan and climbs 5 ft.
    expect(hip.edge_totals.hip).toBeCloseTo(4 * Math.hypot(Math.hypot(15, 15), 5), 0)
    expect(hip.totals.plan_area_sqft).toBeCloseTo(1200, 0)
    expect(hip.totals.roof_area_sqft).toBeCloseTo(1200 * SLOPE_4_12, 0)

    const south = hip.facets.find((f) => f.id === 'south')
    const southEdges = sumFacetEdgeLengths(south.edges)
    expect(southEdges.eave).toBeGreaterThan(30)
    expect(southEdges.hip).toBeGreaterThan(20)
    expect(south.edges.some((e) => e.shared && e.type === 'hip')).toBe(true)
    expect(south.edges.some((e) => e.shared && e.type === 'ridge')).toBe(true)
  })
})

describe('manual trace session helpers', () => {
  it('snaps to a nearby corner before an edge', () => {
    const hit = findSnapTarget(
      { x: 10, y: 4 },
      [{ x: 12, y: 4, latLng: 'corner' }],
      [{ x1: 0, y1: 0, x2: 40, y2: 0 }],
      8,
    )
    expect(hit.kind).toBe('vertex')
    expect(hit.latLng).toBe('corner')
  })

  it('snaps onto an edge when no corner is in range', () => {
    const hit = findSnapTarget(
      { x: 20, y: 3 },
      [{ x: 0, y: 40 }],
      [{ x1: 0, y1: 0, x2: 40, y2: 0 }],
      8,
    )
    expect(hit.kind).toBe('edge')
    expect(hit.y).toBeCloseTo(0, 5)
    expect(hit.x).toBeCloseTo(20, 5)
  })

  it('ignores targets outside the snap radius', () => {
    expect(findSnapTarget({ x: 0, y: 0 }, [{ x: 40, y: 0 }], [], 8)).toBeNull()
  })

  it('starts the next undrawn facet, otherwise creates one', () => {
    expect(planNextFacet([
      { id: 1, hasPolygon: true },
      { id: 2, hasPolygon: false },
    ], 1)).toEqual({ action: 'select', id: 2 })

    expect(planNextFacet([
      { id: 1, hasPolygon: true },
    ], 1)).toMatchObject({ action: 'create', id: 2, name: 'Facet 2', azimuth_degrees: 0 })
  })

  it('lets a drawn line replace one edge type and keeps the trace for the rest', () => {
    const used = resolveEdgeTotals(
      { ridge: 40, hip: 10, valley: 0, rake: 30, eave: 80, step_flashing: 0 },
      { ridge: 22, eave: 0 },
    )
    expect(used.ridge).toBe(22)
    expect(used.eave).toBe(80)
    expect(used.rake).toBe(30)
    expect(used.hip).toBe(10)
    expect(used.drip_edge).toBe(110)
    expect(used.drip_edge_source).toBe('eave_plus_rake')

    const drawnDrip = resolveEdgeTotals(
      { ridge: 40, rake: 30, eave: 80 },
      { drip_edge: 55, eave: 12 },
    )
    expect(drawnDrip.eave).toBe(12)
    expect(drawnDrip.drip_edge).toBe(55)
    expect(drawnDrip.drip_edge_source).toBe('manual')
  })

  it('uses a saved drip edge length, including zero, before eave plus rake', () => {
    expect(estimateDripEdgeLf({ drip_edge_lf: 18.456, rake_lf: 30, eave_lf: 80 })).toBe(18.46)
    expect(estimateDripEdgeLf({ drip_edge_lf: 0, rake_lf: 30, eave_lf: 80 })).toBe(0)
    expect(estimateDripEdgeLf({ rake_lf: 10.126, eave_lf: 5 })).toBe(15.13)
    expect(estimateDripEdgeLf(null)).toBe(0)
  })
})
