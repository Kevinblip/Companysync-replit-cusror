import { describe, it, expect } from 'vitest'
import {
  WALL_FACE_COLORS,
  buildReportHouseModel,
  ridgeAngleFromSegments,
  sanitizeReportFacets,
} from './reportHouseGeometry'

const rect = [[0, 0], [30, 0], [30, 20], [0, 20]]
const ell = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]]

function yValues(groups) {
  const ys = []
  for (const group of groups) {
    for (let i = 1; i < group.positions.length; i += 3) ys.push(group.positions[i])
  }
  return ys
}

describe('report house geometry', () => {
  it('extrudes each footprint edge to the eave and colors it by compass face', () => {
    const model = buildReportHouseModel({ poly: rect, H: 18, slope: 0.5, isHip: true, overhangFt: 0 })
    const byFace = Object.fromEntries(model.walls.map(group => [group.face, group]))
    expect(Object.keys(byFace).sort()).toEqual(['east', 'north', 'south', 'west'])
    expect(byFace.north.color).toBe(WALL_FACE_COLORS.north)
    expect(byFace.south.color).toBe('#f97316')
    expect(byFace.east.color).toBe('#22c55e')
    expect(byFace.west.color).toBe('#a855f7')
    const ys = yValues(model.walls)
    expect(Math.min(...ys)).toBe(0)
    expect(Math.max(...ys)).toBe(18)
    expect(model.walls.reduce((sum, group) => sum + group.positions.length, 0)).toBe(4 * 18)
  })

  it('raises a hip roof by the straight-skeleton distance and drops it at an inside corner', () => {
    const hip = buildReportHouseModel({ poly: rect, H: 18, slope: 0.5, isHip: true, overhangFt: 0 })
    expect(hip.source).toBe('hip_skeleton')
    expect(hip.roofHeightAt(15, 10)).toBeCloseTo(23, 1)
    expect(hip.roofHeightAt(28, 10)).toBeCloseTo(19, 1)
    expect(hip.gables).toEqual([])

    const shaped = buildReportHouseModel({ poly: ell, H: 9, slope: 0.5, isHip: true, overhangFt: 0 })
    expect(shaped.walls.reduce((sum, group) => sum + group.positions.length, 0)).toBe(6 * 18)
    expect(shaped.roofHeightAt(5, 15)).toBeGreaterThan(shaped.roofHeightAt(11, 9) + 1)
    expect(shaped.roof.reduce((sum, group) => sum + group.positions.length, 0)).toBeGreaterThan(36)
  })

  it('keeps a gable ridge high at the rakes', () => {
    const gable = buildReportHouseModel({ poly: rect, H: 18, slope: 0.5, isHip: false, overhangFt: 0 })
    expect(gable.source).toBe('gable_skeleton')
    expect(gable.roofHeightAt(28, 10)).toBeCloseTo(23, 1)
    expect(gable.roofHeightAt(15, 10)).toBeCloseTo(23, 1)
    expect(gable.gables.map(group => group.face).sort()).toEqual(['east', 'west'])
  })

  it('uses measured facets when they cover the footprint and ignores a roof that does not', () => {
    const facets = sanitizeReportFacets([
      { azimuth_degrees: 180, polygon: [[100, 50, 0], [130, 50, 0], [130, 60, 5], [100, 60, 5]] },
      { azimuth_degrees: 0, polygon: [[100, 70, 0], [130, 70, 0], [130, 60, 5], [100, 60, 5]] },
    ])
    const fitted = buildReportHouseModel({ poly: rect, H: 18, slope: 0.5, isHip: false, facets, overhangFt: 0 })
    expect(fitted.source).toBe('measured_facets')
    expect(fitted.roof.map(group => group.face).sort()).toEqual(['north', 'south'])
    const roofYs = yValues(fitted.roof)
    expect(Math.max(...roofYs)).toBeCloseTo(23, 5)
    expect(Math.min(...roofYs)).toBeCloseTo(18, 5)

    const huge = buildReportHouseModel({
      poly: rect,
      H: 18,
      slope: 0.5,
      isHip: true,
      overhangFt: 0,
      facets: [{ azimuth: 180, polygon: [[0, 0, 0], [400, 0, 0], [400, 400, 8], [0, 400, 8]] }],
    })
    expect(huge.source).toBe('hip_skeleton')
  })

  it('orients a gable ridge from segment azimuths and stays runnable after inlining', () => {
    expect(ridgeAngleFromSegments([
      { azimuthDegrees: 180, area: 10 },
      { azimuthDegrees: 0, area: 10 },
    ])).toBeCloseTo(0, 5)

    const inlined = eval(`(${buildReportHouseModel.toString()})`)
    const model = inlined({ poly: ell, H: 12, slope: 6 / 12, isHip: true, overhangFt: 0 })
    expect(model.source).toBe('hip_skeleton')
    expect(model.legend.map(item => item.color)).toEqual(['#3b82f6', '#f97316', '#22c55e', '#a855f7'])
    expect(model.walls.reduce((sum, group) => sum + group.positions.length, 0)).toBe(6 * 18)
  })
})
