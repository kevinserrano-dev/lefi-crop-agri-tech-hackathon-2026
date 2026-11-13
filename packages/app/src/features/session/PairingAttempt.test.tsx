import { screen } from '@testing-library/react';
import type { Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders } from '../../test/render';
import { PairingAttempt } from './BrainStatePanel';

describe('automatic pairing on the sign-in page (ADR-055)', () => {
  it('says why it has not connected yet instead of waiting in silence', async () => {
    const p: Platform = {
      ...fakePlatform(),
      pairingStatus: async () => ({
        status: {
          state: 'retrying',
          message: 'Lefi Brain did not answer at https://lefi-main.local:8443',
          url: 'https://lefi-main.local:8443',
          at: 1,
        },
        offer_waiting: true,
      }),
    };
    renderWithProviders(<PairingAttempt />, { platform: p });
    expect(await screen.findByText(/trying again by itself/)).toBeInTheDocument();
    expect(
      screen.getByText(/did not answer at https:\/\/lefi-main.local:8443/),
    ).toBeInTheDocument();
  });

  it('shows nothing when nothing was ever offered', async () => {
    const { container } = renderWithProviders(<PairingAttempt />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
