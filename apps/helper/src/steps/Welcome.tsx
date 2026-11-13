import { useState } from 'react';
import { mascots } from '@lefi/ui';
import type { SetupContext } from '../api';
import { Badge, Banner, Icon } from '../ui';

export function WelcomeStep({ ctx, onNext }: { ctx: SetupContext; onNext: () => void }) {
  const [mode, setMode] = useState<'single' | null>('single');
  const unsupported = ctx.os !== 'macos' && ctx.os !== 'linux';

  return (
    <section className="step" aria-labelledby="welcome-title">
      <div className="hero">
        <img className="hero-mascot" src={mascots.hero} alt="Lefi, the Lefi Crop mascot" />
        <div>
          <h1 id="welcome-title">Welcome to Lefi Crop</h1>
          <p className="lead">
            Greenhouse intelligence that runs on your own PCs, on your local network. The internet
            is needed only while installing; afterwards everything works offline.
          </p>
        </div>
      </div>

      {unsupported ? (
        <Banner tone="crit" icon="desktop_access_disabled">
          This operating system is not supported yet. Lefi Crop Helper runs on macOS and Linux;
          Windows comes later.
        </Banner>
      ) : null}

      {!unsupported && ctx.install_blocked_reason ? (
        <Banner tone="crit" icon="drive_file_move">
          {ctx.install_blocked_reason}
        </Banner>
      ) : null}

      <h2 className="section-title">How do you want to install?</h2>
      <div className="choice-grid" role="radiogroup" aria-label="Installation mode">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'single'}
          className={`choice ${mode === 'single' ? 'choice-on' : ''}`}
          onClick={() => setMode('single')}
        >
          <Icon name="computer" className="choice-icon" />
          <span className="choice-title">Everything on this PC</span>
          <span className="choice-body">
            AI, Lefi Brain and Lefi Gateway on one machine. Best when this PC has a capable GPU.
          </span>
        </button>
        <button type="button" role="radio" aria-checked={false} className="choice" disabled>
          <Icon name="lan" className="choice-icon" />
          <span className="choice-title">
            Several PCs <Badge tone="off">Not built yet</Badge>
          </span>
          <span className="choice-body">
            This PC sets up the others over the LAN. Needs pairing between PCs, which is not built
            yet. For now, run Lefi Crop Helper on each PC and pick its roles.
          </span>
        </button>
      </div>

      <footer className="actions">
        <span className="muted">
          {ctx.os} · {ctx.arch}
        </span>
        <span className="grow" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!mode || unsupported}
          onClick={onNext}
        >
          Activate <Icon name="arrow_forward" />
        </button>
      </footer>
    </section>
  );
}
