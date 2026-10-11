import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ElevationDrawings from '../components/property/ElevationDrawings.jsx';
import { assembleHoverHouse, assembleSolarHouse, toViewerModel } from '../lib/houseGeometry.js';

const xml = `<?xml version="1.0"?><DATA_EXPORT><LOCATION address="Antoinette"/><FACES>
<FACE id="F1" type="WALL" name="SI-1"><POLYGON path="L1,L2,L3,L4"/></FACE>
<FACE id="F2" type="WALL" name="BR-1"><POLYGON path="L5,L6,L7,L8"/></FACE>
<FACE id="F3" type="WALL" name="ST-1"><POLYGON path="L9,L10,L11,L12"/></FACE>
<FACE id="F4" type="WALL" name="SI-2"><POLYGON path="L13,L14,L15,L16"/></FACE>
<FACE id="F5" type="ROOF" name="RF-1"><POLYGON path="L17,L18,L19,L20" pitch="6"/></FACE>
<FACE id="F6" type="ROOF" name="RF-2"><POLYGON path="L21,L22,L23,L24" pitch="6"/></FACE>
</FACES><LINES>
<LINE id="L1" path="C1,C2"/><LINE id="L2" path="C2,C3"/><LINE id="L3" path="C3,C4"/><LINE id="L4" path="C4,C1"/>
<LINE id="L5" path="C2,C5"/><LINE id="L6" path="C5,C6"/><LINE id="L7" path="C6,C3"/><LINE id="L8" path="C3,C2"/>
<LINE id="L9" path="C5,C7"/><LINE id="L10" path="C7,C8"/><LINE id="L11" path="C8,C6"/><LINE id="L12" path="C6,C5"/>
<LINE id="L13" path="C7,C1"/><LINE id="L14" path="C1,C4"/><LINE id="L15" path="C4,C8"/><LINE id="L16" path="C8,C7"/>
<LINE id="L17" path="C4,C3"/><LINE id="L18" path="C3,C9"/><LINE id="L19" path="C9,C10"/><LINE id="L20" path="C10,C4"/>
<LINE id="L21" path="C8,C6"/><LINE id="L22" path="C6,C9"/><LINE id="L23" path="C9,C10"/><LINE id="L24" path="C10,C8"/>
</LINES><POINTS>
<POINT id="C1" data="-20,-15,0"/><POINT id="C2" data="20,-15,0"/><POINT id="C3" data="20,-15,18"/><POINT id="C4" data="-20,-15,18"/>
<POINT id="C5" data="20,15,0"/><POINT id="C6" data="20,15,18"/><POINT id="C7" data="-20,15,0"/><POINT id="C8" data="-20,15,18"/>
<POINT id="C9" data="0,15,28"/><POINT id="C10" data="0,-15,28"/>
</POINTS></DATA_EXPORT>`;

describe('ElevationDrawings UI', () => {
  it('labels Hover elevations as Hover model with real height, not NOT PHOTOGRAPHED', () => {
    const model = toViewerModel(assembleHoverHouse(xml));
    const { getAllByText, queryByText } = render(
      <ElevationDrawings elevations={model.elevations} source="hover" />
    );
    expect(queryByText(/NOT PHOTOGRAPHED/)).toBeNull();
    expect(getAllByText(/Hover model/).length).toBeGreaterThan(0);
    expect(getAllByText(/18 ft/).length).toBeGreaterThan(0);
  });

  it('keeps assembled solar elevations off the 48×9 placeholder once walls exist', () => {
    const model = toViewerModel(assembleSolarHouse({ lengthFt: 40, widthFt: 32, eaveHeightFt: 18, pitch: '6/12' }));
    const front = model.elevations.find(e => e.id === 'front');
    expect(front.height_ft).toBe(18);
    expect(front.width_ft).toBe(32);
    expect(front.caption).toBe('Assembled — not photographed');
  });
});
