import type { ReactNode } from 'react';
import type { ScreenDef } from '../../app/screen';
import { EmptyState } from '../../shared/ui';
import { useBrainKind } from './useBrainKind';

/**
 * Against the real Lefi Brain, a screen whose data Lefi Brain does not serve yet says so plainly:
 * nothing is invented and no sample data is shown as real (ADR-049). The development mock serves
 * the whole proposal, labelled as sample data, so the screen renders as before.
 */
export function NotServedYet({ screen, children }: { screen: ScreenDef; children: ReactNode }) {
  const kind = useBrainKind();
  if (!kind.known) return null; // until health answered, ask for nothing
  if (!kind.mock && screen.live && kind.serves(screen.live.endpoint)) {
    const Live = screen.live.component;
    return <Live />;
  }
  if (kind.serves(screen.brain.endpoint)) return <>{children}</>;
  return (
    <EmptyState mascot="curious" title={`${screen.title} is not available yet`}>
      Lefi Brain does not serve this screen yet: it needs {screen.brain.module}, which is planned.
      Nothing is shown here until Lefi Brain provides real data.
    </EmptyState>
  );
}
