import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ElevationDrawings from '@/components/property/ElevationDrawings';
import { assembleEstimatorHouse, toViewerModel } from '@/lib/houseGeometry';

describe('ElevationDrawings', () => {
  it('renders uploaded facade photos instead of NOT PHOTOGRAPHED placeholders', () => {
    const photos = [
      { label: 'Front', url: 'https://example.com/front.jpg' },
      { label: 'Back', url: 'https://example.com/back.jpg' },
    ];
    const model = toViewerModel(assembleEstimatorHouse({
      photos,
      photoAnalysis: { building_length_ft: 40, building_width_ft: 32, story_height_ft: 18, story_count: 2 },
    }), { photos });

    render(<ElevationDrawings elevations={model.elevations} />);

    expect(screen.getByTestId('elevation-front-photo')).toBeInTheDocument();
    expect(screen.getByTestId('elevation-front-status').textContent).toMatch(/photographed/i);
    expect(screen.getByTestId('elevation-front').textContent).not.toMatch(/NOT PHOTOGRAPHED/i);
    expect(screen.getByTestId('elevation-back-photo')).toBeInTheDocument();
    expect(screen.getByTestId('elevation-left').textContent).not.toMatch(/48 ft/);
  });
});
