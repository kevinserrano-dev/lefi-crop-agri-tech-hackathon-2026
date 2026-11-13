import { act, screen } from '@testing-library/react';
import { ApiError, type Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders } from '../../test/render';
import { DeviceRevokedPanel } from './DeviceCard';

const identity = (deviceId: string) => ({
  deviceId,
  caFingerprint: 'ab'.repeat(32),
  pairedAt: '2026-11-08T10:00:00Z',
  url: 'https://lefi-main.local:8443',
});

const refused = (code: string, details: Record<string, unknown> = {}) =>
  new ApiError(401, { error: { code, message: 'TEST', details } });

describe('Lefi Brain refuses this PC', () => {
  afterEach(() => vi.useRealTimers());

  it('goes back to sign-in by itself when Lefi Crop Helper gives this PC a new pairing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let id = 'old-revoked-device';
    const recovered = vi.fn();
    const p: Platform = { ...fakePlatform(), device: async () => identity(id) as never };
    renderWithProviders(
      <DeviceRevokedPanel
        error={refused('DEVICE_REVOKED', { reason: 'revoked' })}
        onRecovered={recovered}
      />,
      { platform: p },
    );
    expect(
      await screen.findByText('An administrator removed this PC from Lefi Brain'),
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(recovered).not.toHaveBeenCalled(); // same pairing: stay
    id = 'new-device-after-reset';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  // ADR-056: one message per reason Lefi Brain gives, so nobody reads "removed" when it was not.
  it.each([
    ['DEVICE_REVOKED', 'revoked', 'An administrator removed this PC from Lefi Brain', true],
    ['DEVICE_REVOKED', 'replaced', 'This PC was paired again', true],
    ['DEVICE_REVOKED', 'expired', "This PC's certificate has ended", true],
    [
      'DEVICE_NOT_PAIRED',
      'no_certificate',
      'Lefi Gateway did not ask this PC for its certificate',
      false,
    ],
    ['DEVICE_NOT_PAIRED', 'unknown_certificate', 'Lefi Brain does not know this PC', true],
    [
      'DEVICE_NOT_PAIRED',
      'not_through_gateway',
      'This PC reached Lefi Brain without Lefi Gateway',
      true,
    ],
    ['DEVICE_NOT_PAIRED', undefined, 'Lefi Brain refused this PC', true],
  ])('%s %s → "%s"', async (code, reason, title, canForget) => {
    const p: Platform = { ...fakePlatform(), device: async () => identity('paired-1') as never };
    renderWithProviders(
      <DeviceRevokedPanel
        error={refused(code, reason ? { reason } : {})}
        url="https://192.0.2.10:8443"
      />,
      { platform: p },
    );
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByText('This PC was removed from Lefi Brain')).not.toBeInTheDocument();
    expect(!!screen.queryByRole('button', { name: /Forget this pairing/ })).toBe(canForget);
    expect(screen.getByTestId('refusal-details')).toHaveTextContent(code);
    expect(screen.getByTestId('refusal-details')).toHaveTextContent('https://192.0.2.10:8443');
  });

  it('without a pairing, no certificate means "not paired", not "removed"', async () => {
    const p: Platform = { ...fakePlatform(), device: async () => null };
    renderWithProviders(
      <DeviceRevokedPanel error={refused('DEVICE_NOT_PAIRED', { reason: 'no_certificate' })} />,
      { platform: p },
    );
    expect(await screen.findByText('This PC is not paired with Lefi Brain')).toBeInTheDocument();
  });
});
