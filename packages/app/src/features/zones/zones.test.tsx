import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ZoneForm } from '@lefi/api';
import type { ApiRequest, Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders } from '../../test/render';
import { NewZoneForm } from './NewZoneForm';

const form: ZoneForm = {
  can_create: { allowed: true, reason: null },
  greenhouses: [{ id: 'GH-9', label: 'GH-9 · Fake house', next_id: 'GH9-Z1' }],
  uses: ['Production'],
  systems: ['Fake system'],
  robot_speeds: ['0.3 m/s'],
  supervisors: ['Fake Supervisor'],
};

function platformWith(calls: ApiRequest[]): Platform {
  const p = fakePlatform();
  p.api = async <T,>(req: ApiRequest): Promise<T> => {
    calls.push(req);
    if (req.method === 'GET') return form as T;
    return { item: { id: 'GH9-Z1' }, message: 'GH9-Z1 created.' } as T;
  };
  return p;
}

describe('New zone', () => {
  it('shows the next id from the Brain and sends the zone without device slots', async () => {
    const calls: ApiRequest[] = [];
    const done = vi.fn();
    renderWithProviders(<NewZoneForm onDone={done} />, { platform: platformWith(calls) });
    expect(await screen.findByText('GH9-Z1')).toBeInTheDocument();
    expect(screen.getByText(/devices are not created here/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Zone name *'), 'Bay Z');
    await userEvent.click(screen.getByRole('button', { name: 'Create zone' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith('GH9-Z1'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      greenhouse_id: 'GH-9',
      name: 'Bay Z',
      use: 'Production',
      crop: '',
      system: 'Fake system',
      area_m2: 4500,
      rows: 18,
      plants: null,
      supervisor: 'Fake Supervisor',
      robot_speed: '0.3 m/s',
    });
  });
});
