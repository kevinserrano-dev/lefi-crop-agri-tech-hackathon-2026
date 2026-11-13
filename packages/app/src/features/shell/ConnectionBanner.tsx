import { useNavigate } from '@tanstack/react-router';
import type { SystemStatus } from '@lefi/api';
import { Banner, Button } from '../../shared/ui';
import { clock } from '../../shared/lib/time';

export function ConnectionBanner({ lastContact }: { lastContact: string | undefined }) {
  return (
    <Banner tone="crit" icon="wifi_off" title="Connection to Lefi Brain lost">
      Data on screen is from the last successful update
      {lastContact ? ` (Lefi Brain time ${clock(lastContact)})` : ''} and may be stale. Retrying
      automatically.
    </Banner>
  );
}

/** Shown on every screen while the AI kill switch is on (design: AI banner). */
export function AiStoppedBanner({ ai }: { ai: SystemStatus['ai'] }) {
  const navigate = useNavigate();
  return (
    <Banner
      tone="crit"
      icon="front_hand"
      title={`Emergency stop active — ${ai.halt_scope === 'all' ? 'Lefi AI and all automations stopped' : 'Lefi AI stopped'}`}
      action={
        <Button variant="secondary" size="sm" onClick={() => void navigate({ to: '/ai-control' })}>
          Open AI Control
        </Button>
      }
    >
      {ai.reason ? `${ai.reason}. ` : ''}LEFI CROP keeps working without AI: live readings,
      threshold alerts, incidents, tasks and manual robot controls. Paused: AI diagnosis,
      recommendations, AI dispatch and natural-language commands.
    </Banner>
  );
}
