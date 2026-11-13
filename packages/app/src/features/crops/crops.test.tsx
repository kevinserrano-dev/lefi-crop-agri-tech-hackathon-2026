import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlantProfile } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders } from '../../test/render';
import { useToast } from '../../shared/ui';
import { PlantView } from './PlantView';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => undefined }));

const plant = (observe: boolean): PlantProfile => ({
  id: 'P-0001',
  variety: 'Fake lettuce',
  row: 'Row 1 · Pos 1',
  batch_id: 'B-0001',
  zone_id: 'Z1',
  zone_name: 'Zone one',
  greenhouse_name: 'Fake house',
  stage: 'Vegetative',
  age_days: 20,
  sown: 'Oct 1',
  progress: 60,
  health: { value: 80, tone: 'warn', label: 'Warning' },
  health_14d: [80, 81, 80],
  height_cm: 10,
  leaves: 9,
  estimates_simulated: true,
  image_url: null,
  environment: [{ label: 'EC', value: '1.6 mS/cm', note: 'Within range' }],
  ranges_placeholder: true,
  detections: [],
  observations: [],
  actions: {
    observe: observe
      ? { allowed: true, reason: null }
      : { allowed: false, reason: 'Requires permission.' },
  },
  origin: 'SIMULATED',
});

function platformWith(calls: ApiRequest[], observe: boolean): Platform {
  const p = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.method === 'GET') return plant(observe) as T;
    return { item: plant(observe), message: 'Observation saved to P-0001.' } as T;
  };
  return p;
}

describe('Plant profile', () => {
  it('labels estimates as simulated, ranges as placeholder, and has no photo', async () => {
    renderWithProviders(<PlantView id="P-0001" />, { platform: platformWith([], true) });
    expect(await screen.findAllByText('Simulated estimate')).toHaveLength(2);
    expect(screen.getByText('Placeholder ranges')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'No image: P-0001' })).toBeInTheDocument();
    expect(screen.getByText(/no vision model connected/i)).toBeInTheDocument();
  });

  it('sends an observation to the Brain', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<PlantView id="P-0001" />, { platform: platformWith(calls, true) });
    await userEvent.click(await screen.findByRole('button', { name: 'Log observation' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Observation' }), 'Roots white');
    await userEvent.click(screen.getByRole('button', { name: 'Save observation' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/plants/P-0001/observations',
        body: { note: 'Roots white' },
      }),
    );
  });

  it('keeps logging locked when the Brain does not allow it', async () => {
    const calls: ApiRequest[] = [];
    renderWithProviders(<PlantView id="P-0001" />, { platform: platformWith(calls, false) });
    await userEvent.click(await screen.findByRole('button', { name: 'Log observation' }));
    expect(useToast.getState().toast?.msg).toBe('Requires permission.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
