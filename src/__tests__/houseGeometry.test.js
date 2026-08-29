import { describe, it, expect } from 'vitest';
import {
  parseHoverXml3d,
  assembleHoverHouse,
  assembleSolarHouse,
  isHouseAssembled,
  buildElevationDrawings,
  toViewerModel,
  applyJsonMaterials,
  DEFAULT_ESTIMATED_WIDTH_FT,
  DEFAULT_ESTIMATED_HEIGHT_FT,
} from '../lib/houseGeometry.js';
import { buildHoverHouseModel, normalizeHoverJobId, hoverCredentialsConfigured, resetHoverTokenCache } from '../lib/hoverHouseModel.js';

const SIMPLE_HOVER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DATA_EXPORT>
<LOCATION address="Antoinette Pa, Sample St" lat="41.5" long="-81.5"/>
<STRUCTURES>
<ROOF id="ROOF1">
<FACES>
<FACE id="F1" type="WALL" name="SI-1">
<POLYGON id="P1" path="L1,L2,L3,L4" size="360"/>
</FACE>
<FACE id="F2" type="WALL" name="BR-1">
<POLYGON id="P2" path="L5,L6,L7,L8" size="270"/>
</FACE>
<FACE id="F3" type="WALL" name="ST-1">
<POLYGON id="P3" path="L9,L10,L11,L12" size="360"/>
</FACE>
<FACE id="F4" type="WALL" name="SI-2">
<POLYGON id="P4" path="L13,L14,L15,L16" size="270"/>
</FACE>
<FACE id="F5" type="ROOF" name="RF-1">
<POLYGON id="P5" path="L17,L18,L19,L20" size="500" pitch="6"/>
</FACE>
<FACE id="F6" type="ROOF" name="RF-2">
<POLYGON id="P6" path="L21,L22,L23,L24" size="500" pitch="6"/>
</FACE>
</FACES>
<LINES>
<LINE id="L1" type="BOTTOMWALL" path="C1,C2"/>
<LINE id="L2" type="OTHER" path="C2,C3"/>
<LINE id="L3" type="TOPWALL" path="C3,C4"/>
<LINE id="L4" type="OTHER" path="C4,C1"/>
<LINE id="L5" type="BOTTOMWALL" path="C2,C5"/>
<LINE id="L6" type="OTHER" path="C5,C6"/>
<LINE id="L7" type="TOPWALL" path="C6,C3"/>
<LINE id="L8" type="OTHER" path="C3,C2"/>
<LINE id="L9" type="BOTTOMWALL" path="C5,C7"/>
<LINE id="L10" type="OTHER" path="C7,C8"/>
<LINE id="L11" type="TOPWALL" path="C8,C6"/>
<LINE id="L12" type="OTHER" path="C6,C5"/>
<LINE id="L13" type="BOTTOMWALL" path="C7,C1"/>
<LINE id="L14" type="OTHER" path="C1,C4"/>
<LINE id="L15" type="TOPWALL" path="C4,C8"/>
<LINE id="L16" type="OTHER" path="C8,C7"/>
<LINE id="L17" type="EAVE" path="C4,C3"/>
<LINE id="L18" type="RAKE" path="C3,C9"/>
<LINE id="L19" type="RIDGE" path="C9,C10"/>
<LINE id="L20" type="RAKE" path="C10,C4"/>
<LINE id="L21" type="EAVE" path="C8,C6"/>
<LINE id="L22" type="RAKE" path="C6,C9"/>
<LINE id="L23" type="RIDGE" path="C9,C10"/>
<LINE id="L24" type="RAKE" path="C10,C8"/>
</LINES>
<POINTS>
<POINT id="C1" data="-20,-15,0"/>
<POINT id="C2" data="20,-15,0"/>
<POINT id="C3" data="20,-15,18"/>
<POINT id="C4" data="-20,-15,18"/>
<POINT id="C5" data="20,15,0"/>
<POINT id="C6" data="20,15,18"/>
<POINT id="C7" data="-20,15,0"/>
<POINT id="C8" data="-20,15,18"/>
<POINT id="C9" data="0,15,28"/>
<POINT id="C10" data="0,-15,28"/>
</POINTS>
</ROOF>
</STRUCTURES>
</DATA_EXPORT>`;

describe('houseGeometry Hover XML', () => {
  it('walks FACE → LINE → POINT in a shared frame so the house is assembled', () => {
    const parsed = parseHoverXml3d(SIMPLE_HOVER_XML);
    expect(parsed.faces.length).toBe(6);
    expect(parsed.address).toContain('Antoinette');
    expect(isHouseAssembled(parsed.faces)).toBe(true);

    const house = assembleHoverHouse(SIMPLE_HOVER_XML);
    expect(house.source).toBe('hover');
    expect(house.estimated).toBe(false);
    expect(house.assembled).toBe(true);
    expect(house.footprint.eave_height_ft).toBe(18);
    expect(house.footprint.width_ft).toBe(40);
  });

  it('maps Hover wall names to siding / brick / stone instead of a single estimated box', () => {
    const house = assembleHoverHouse(SIMPLE_HOVER_XML);
    const mats = new Set(house.faces.filter(f => f.type === 'WALL').map(f => f.material));
    expect(mats.has('siding')).toBe(true);
    expect(mats.has('brick')).toBe(true);
    expect(mats.has('stone')).toBe(true);
  });

  it('builds elevation drawings from real Hover wall extents, not 48×9 placeholders', () => {
    const house = assembleHoverHouse(SIMPLE_HOVER_XML);
    const elevations = buildElevationDrawings(house.faces, { estimated: false });
    expect(elevations).toHaveLength(4);
    for (const el of elevations) {
      expect(el.caption).toBe('From Hover model');
      expect(el.estimated).toBe(false);
      expect(el.width_ft).not.toBe(DEFAULT_ESTIMATED_WIDTH_FT);
      expect(el.height_ft).toBe(18);
      expect(el.height_ft).not.toBe(DEFAULT_ESTIMATED_HEIGHT_FT);
    }
    const front = elevations.find(e => e.id === 'front');
    expect(front.width_ft).toBe(40);
  });
});

describe('houseGeometry solar assembly', () => {
  it('attaches roof planes to walls instead of exploding independent bounding boxes', () => {
    const house = assembleSolarHouse({
      lengthFt: 48,
      widthFt: 32,
      eaveHeightFt: 9,
      pitch: '6/12',
      roofType: 'gable',
    });
    expect(house.assembled).toBe(true);
    expect(isHouseAssembled(house.faces)).toBe(true);

    const roofs = house.faces.filter(f => f.type === 'ROOF');
    const walls = house.faces.filter(f => f.type === 'WALL');
    const wallMaxZ = Math.max(...walls.flatMap(f => f.vertices.map(v => v.z)));
    const roofMinZ = Math.min(...roofs.flatMap(f => f.vertices.map(v => v.z)));
    expect(roofMinZ).toBe(wallMaxZ);
  });

  it('does not treat independent lat/lng boxes as an assembled house', () => {
    const exploded = [
      { type: 'WALL', vertices: [{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }, { x: 40, y: 0, z: 9 }, { x: 0, y: 0, z: 9 }] },
      { type: 'WALL', vertices: [{ x: 0, y: 30, z: 0 }, { x: 40, y: 30, z: 0 }, { x: 40, y: 30, z: 9 }, { x: 0, y: 30, z: 9 }] },
      { type: 'ROOF', vertices: [{ x: 400, y: 0, z: 40 }, { x: 480, y: 0, z: 40 }, { x: 480, y: 30, z: 50 }, { x: 400, y: 30, z: 50 }] },
      { type: 'ROOF', vertices: [{ x: -300, y: 80, z: 55 }, { x: -220, y: 80, z: 55 }, { x: -220, y: 110, z: 62 }, { x: -300, y: 110, z: 62 }] },
    ];
    expect(isHouseAssembled(exploded)).toBe(false);
  });

  it('only uses 48×9 estimated elevation boxes when there are no wall faces', () => {
    const empty = buildElevationDrawings([]);
    expect(empty.every(e => e.estimated)).toBe(true);
    expect(empty[0].width_ft).toBe(48);
    expect(empty[0].height_ft).toBe(9);
    expect(empty[0].caption).toBe('NOT PHOTOGRAPHED — ESTIMATED');
  });
});

describe('hoverHouseModel', () => {
  it('normalizes Hover job URLs like Kevin’s Antoinette job', () => {
    expect(normalizeHoverJobId('https://hover.to/my/jobs/2-1514588/workspace/siding/model/21937601'))
      .toBe('2-1514588');
    expect(normalizeHoverJobId('2-1514588')).toBe('2-1514588');
  });

  it('does not claim Hover is configured when env vars are missing', () => {
    expect(hoverCredentialsConfigured({})).toBe(false);
  });

  it('falls back to an assembled (not exploded) house when Hover credentials are absent', async () => {
    resetHoverTokenCache();
    const result = await buildHoverHouseModel({
      address: 'Antoinette Pa',
      building: { building_length_ft: 48, building_width_ft: 32, story_count: 2, story_height_ft: 9, pitch: '6/12', roof_type: 'complex' },
    }, {});
    expect(result.success).toBe(true);
    expect(result.hover_used).toBe(false);
    expect(result.hover_reason).toBe('hover_credentials_missing');
    expect(result.model.assembled).toBe(true);
    expect(result.model.faces.some(f => f.type === 'ROOF')).toBe(true);
    expect(result.model.faces.some(f => f.type === 'WALL')).toBe(true);
  });

  it('uses Hover XML when the API returns cad_export.xml', async () => {
    resetHoverTokenCache();
    const fetchImpl = async (url) => {
      if (String(url).includes('/oauth/token')) {
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      if (String(url).includes('/api/v3/jobs/2-1514588')) {
        return { ok: true, json: async () => ({ id: '2-1514588', name: 'Antoinette Pa', models: [{ id: 21937601, state: 'complete' }] }) };
      }
      if (String(url).includes('cad_export.xml')) {
        return { ok: true, text: async () => SIMPLE_HOVER_XML };
      }
      if (String(url).includes('measurements.json')) {
        return { ok: true, json: async () => ({ siding: { facets: [{ name: 'SI-1', material: 'horizontal siding' }] } }) };
      }
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    };

    const result = await buildHoverHouseModel(
      { hoverJobId: '2-1514588', address: 'Antoinette Pa' },
      { HOVER_CLIENT_ID: 'id', HOVER_CLIENT_SECRET: 'secret', HOVER_REFRESH_TOKEN: 'refresh' },
      fetchImpl,
    );
    expect(result.hover_used).toBe(true);
    expect(result.source).toBe('hover');
    expect(result.model.assembled).toBe(true);
    expect(result.model.elevations.every(e => e.caption === 'From Hover model')).toBe(true);
    expect(result.model.elevations.every(e => e.height_ft === 18)).toBe(true);
  });

  it('applies JSON siding materials onto Hover faces', () => {
    const house = assembleHoverHouse(SIMPLE_HOVER_XML);
    const updated = applyJsonMaterials(house.faces, { siding: { facets: [{ name: 'SI-1', material: 'stone' }] } });
    expect(updated.find(f => f.name === 'SI-1').material).toBe('stone');
  });

  it('toViewerModel exposes customer-facing chips (materials + facades)', () => {
    const model = toViewerModel(assembleHoverHouse(SIMPLE_HOVER_XML));
    expect(model.materials.some(m => m.id === 'stone')).toBe(true);
    expect(model.facades.some(f => f.id === 'N')).toBe(true);
  });
});
