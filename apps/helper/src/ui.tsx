import type { ReactNode } from 'react';
import type { SetupError } from './api';

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-rounded icon ${className ?? ''}`} aria-hidden="true">
      {name}
    </span>
  );
}

export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'off' | 'sim';

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Banner({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  icon: string;
  children: ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'crit' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function ErrorBox({ error, title }: { error: SetupError; title?: string }) {
  return (
    <Banner tone="crit" icon="error">
      <strong>{title ?? 'Something went wrong'}</strong>
      <p>{error.message}</p>
      {error.hint ? <p className="muted">{error.hint}</p> : null}
      <code className="code-chip">{error.code}</code>
    </Banner>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner-row" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Bar({ percent, label }: { percent: number | null; label: string }) {
  return (
    <div
      className="bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      <div
        className={`bar-fill ${percent == null ? 'bar-indeterminate' : ''}`}
        style={{ width: `${percent ?? 30}%` }}
      />
    </div>
  );
}

export function Disclosure({
  title,
  children,
  open,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="disclosure" open={open}>
      <summary>
        <Icon name="chevron_right" className="disclosure-chevron" />
        {title}
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

export function LogView({ lines }: { lines: string[] }) {
  return (
    <pre className="log" tabIndex={0} aria-label="Installer output">
      {lines.length ? lines.join('\n') : 'No output yet.'}
    </pre>
  );
}
