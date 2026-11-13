import type { SetupAnswers } from './api';

/** The last installation on this PC, as recorded on disk (src-tauri/src/session.rs). */
export interface InstallSession {
  state: 'none' | 'ok' | 'failed' | 'interrupted' | 'still_running';
  answers: SetupAnswers | null;
  runs: number;
}

/** Should the app offer to continue or undo instead of starting the guided steps? */
export function needsDecision(s: InstallSession | null): boolean {
  if (!s) return false;
  return (
    s.state === 'still_running' ||
    ((s.state === 'failed' || s.state === 'interrupted') && !!s.answers)
  );
}
