import { useState } from 'react';
import type { InstallSession } from '../resume';
import { Banner, Icon, Spinner } from '../ui';

const COPY = {
  interrupted: {
    title: 'The installation did not finish',
    body: 'Lefi Crop Helper closed before the installation ended. Nothing was undone.',
  },
  failed: {
    title: 'The last installation stopped with an error',
    body: 'What it had already done is still on this PC. Nothing was undone.',
  },
} as const;

/** Shown on opening when the last installation did not end well (ADR-039). */
export function ResumeStep({
  session,
  onContinue,
  onUndo,
  onLater,
}: {
  session: InstallSession;
  onContinue: () => void;
  onUndo: () => void;
  onLater: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (session.state === 'still_running') {
    return (
      <section className="step" aria-labelledby="resume-title">
        <header className="step-head">
          <h1 id="resume-title">The installation is still working</h1>
          <p className="lead">
            It kept running after Lefi Crop Helper closed. This screen changes by itself when it
            ends; you can leave it open.
          </p>
        </header>
        <Spinner label="Waiting for the installation to end…" />
      </section>
    );
  }

  const c = session.state === 'failed' ? COPY.failed : COPY.interrupted;
  return (
    <section className="step" aria-labelledby="resume-title">
      <header className="step-head">
        <h1 id="resume-title">{c.title}</h1>
        <p className="lead">{c.body}</p>
      </header>
      <div className="card">
        <h2 className="card-title">
          <Icon name="play_arrow" /> Continue
        </h2>
        <p className="muted">
          Runs the installation again with the same choices. Steps that are already done are checked
          and not repeated.
        </p>
      </div>
      <div className="card">
        <h2 className="card-title">
          <Icon name="settings_backup_restore" /> Undo the changes
        </h2>
        <p className="muted">
          Removes what this installation added, so you can start again. Software that was on this PC
          before is kept. Your activation stays.
        </p>
      </div>
      {confirming ? (
        <div className="confirm" role="alertdialog" aria-labelledby="undo-q">
          <p id="undo-q">
            <strong>Undo everything this installation changed?</strong>
          </p>
          <div className="row-end">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Back
            </button>
            <button type="button" className="btn btn-danger" onClick={onUndo}>
              <Icon name="settings_backup_restore" /> Undo the changes
            </button>
          </div>
        </div>
      ) : null}
      <footer className="actions">
        <button type="button" className="btn" onClick={() => setConfirming(true)}>
          <Icon name="settings_backup_restore" /> Undo the changes
        </button>
        <button type="button" className="btn" onClick={onLater}>
          Not now
        </button>
        <span className="grow" />
        <button type="button" className="btn btn-primary" onClick={onContinue}>
          <Icon name="play_arrow" /> Continue the installation
        </button>
      </footer>
    </section>
  );
}

/** On reopening after an installation that ended well. */
export function SessionOkNote() {
  return (
    <Banner tone="ok" icon="verified">
      Lefi Crop is installed on this PC. You can run the guided steps again to change it or to check
      it.
    </Banner>
  );
}
