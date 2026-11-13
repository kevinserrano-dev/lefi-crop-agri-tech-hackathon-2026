/**
 * Folds the installer's NDJSON events into what the screens show. Progress is only what the
 * installer reports (steps done / declared total, or real byte counters) — never estimated.
 */
import type { InstallerEvent, InstallerMsg } from './api';

export type StepState = 'pending' | 'running' | 'ok' | 'skipped' | 'failed' | 'cancelled';
export type LogLevel = 'info' | 'pass' | 'warn' | 'fail' | 'pending' | 'error' | string;

export interface Failure {
  code: string;
  message: string;
  hint: string;
}

export interface StepView {
  id: string;
  title: string;
  state: StepState;
  reason?: string;
  logs: Array<{ level: LogLevel; message: string }>;
  warnings: string[];
  progress?: { done: number; total: number; unit: string };
  failure?: Failure;
}

export interface RunView {
  started: boolean;
  mode?: string;
  dryRun?: boolean;
  roles?: string;
  steps: StepView[];
  stepsDone: number;
  stepsTotal: number;
  /** plan.done result: ok · failed · cancelled. */
  result?: string;
  checks?: { pass: number; warn: number; fail: number; pending: number };
  durationS?: number;
  log?: string;
  /** A failure reported outside any step (e.g. invalid answers before the plan starts). */
  failure?: Failure;
  /** Undo of this run's changes (ADR-032): after Cancel, or "Undo the changes" after a failure. */
  rollback?: RollbackView;
  output: string[];
}

export interface RollbackItem {
  label: string;
  result: 'ok' | 'skipped' | 'failed' | string;
  message: string;
}

export interface RollbackView {
  reason: string;
  total: number;
  items: RollbackItem[];
  /** ok · partial · nothing — set when finished. */
  result?: string;
  ok?: number;
  failed?: number;
  skipped?: number;
  report?: string;
}

const MAX_OUTPUT_LINES = 3000;

export const emptyRun: RunView = {
  started: false,
  steps: [],
  stepsDone: 0,
  stepsTotal: 0,
  output: [],
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

function updateStep(view: RunView, id: string, fn: (s: StepView) => StepView): RunView {
  let found = false;
  const steps = view.steps.map((s) => {
    if (s.id !== id) return s;
    found = true;
    return fn(s);
  });
  if (!found && id) {
    steps.push(fn({ id, title: id, state: 'pending', logs: [], warnings: [] }));
  }
  return { ...view, steps };
}

function counters(view: RunView, ev: InstallerEvent): RunView {
  const done = num(ev.steps_done);
  const total = num(ev.steps_total);
  return { ...view, stepsDone: done ?? view.stepsDone, stepsTotal: total ?? view.stepsTotal };
}

function applyEvent(view: RunView, ev: InstallerEvent): RunView {
  const step = str(ev.step);
  switch (ev.event) {
    case 'plan.started': {
      const declared = Array.isArray(ev.steps)
        ? (ev.steps as Array<{ id?: unknown; title?: unknown }>)
        : [];
      return {
        ...view,
        started: true,
        mode: str(ev.mode),
        dryRun: ev.dry_run === true,
        roles: str(ev.roles),
        stepsTotal: num(ev.steps_total) ?? declared.length,
        stepsDone: 0,
        steps: declared.map((s) => ({
          id: str(s.id),
          title: str(s.title) || str(s.id),
          state: 'pending' as const,
          logs: [],
          warnings: [],
        })),
      };
    }
    case 'step.started':
      return updateStep(counters(view, ev), step, (s) => ({
        ...s,
        title: str(ev.title) || s.title,
        state: 'running',
      }));
    case 'step.ok':
      return updateStep(counters(view, ev), step, (s) => ({
        ...s,
        state: ev.skipped === true ? 'skipped' : 'ok',
        reason: str(ev.reason) || undefined,
      }));
    case 'step.progress': {
      const done = num(ev.done);
      const total = num(ev.total);
      if (done === undefined || total === undefined) return view;
      return updateStep(view, step, (s) => ({
        ...s,
        progress: { done, total, unit: str(ev.unit) },
      }));
    }
    case 'step.log':
      return updateStep(view, step, (s) => ({
        ...s,
        logs: [...s.logs, { level: str(ev.level) || 'info', message: str(ev.message) }],
      }));
    case 'step.warn':
      return updateStep(view, step, (s) => ({ ...s, warnings: [...s.warnings, str(ev.message)] }));
    case 'step.failed': {
      const failure = { code: str(ev.code), message: str(ev.message), hint: str(ev.hint) };
      if (!step) return { ...counters(view, ev), failure };
      const state: StepState = failure.code === 'CANCELLED' ? 'cancelled' : 'failed';
      return updateStep(counters(view, ev), step, (s) => ({ ...s, state, failure }));
    }
    case 'plan.done': {
      const c = ev.checks as Record<string, unknown> | undefined;
      return {
        ...counters(view, ev),
        result: str(ev.result),
        durationS: num(ev.duration_s),
        log: str(ev.log) || undefined,
        checks: c
          ? {
              pass: num(c.pass) ?? 0,
              warn: num(c.warn) ?? 0,
              fail: num(c.fail) ?? 0,
              pending: num(c.pending) ?? 0,
            }
          : view.checks,
      };
    }
    case 'rollback.started':
      return {
        ...view,
        rollback: { reason: str(ev.reason), total: num(ev.items_total) ?? 0, items: [] },
      };
    case 'rollback.item': {
      const rb = view.rollback ?? { reason: '', total: num(ev.items_total) ?? 0, items: [] };
      const item = { label: str(ev.label), result: str(ev.result), message: str(ev.message) };
      return { ...view, rollback: { ...rb, items: [...rb.items, item] } };
    }
    case 'rollback.done': {
      const rb = view.rollback ?? { reason: '', total: 0, items: [] };
      return {
        ...view,
        rollback: {
          ...rb,
          result: str(ev.result),
          ok: num(ev.ok),
          failed: num(ev.failed),
          skipped: num(ev.skipped),
          report: str(ev.report) || undefined,
        },
      };
    }
    default:
      return view;
  }
}

export function applyMsg(view: RunView, msg: InstallerMsg): RunView {
  if (msg.kind === 'event') return applyEvent(view, msg.event);
  const output =
    view.output.length >= MAX_OUTPUT_LINES
      ? [...view.output.slice(-(MAX_OUTPUT_LINES - 1)), msg.line]
      : [...view.output, msg.line];
  return { ...view, output };
}

export function fromEvents(events: InstallerEvent[], output: string[] = []): RunView {
  const v = events.reduce(applyEvent, emptyRun);
  return { ...v, output: output.slice(-MAX_OUTPUT_LINES) };
}

/** PASS/WARN/FAIL/PENDING lines the installer's verification printed (scripts/lib/verify.sh). */
export function checkLines(
  view: RunView,
): Array<{ level: 'pass' | 'warn' | 'fail' | 'pending'; message: string }> {
  const verify = view.steps.find((s) => s.id === 'verify');
  if (!verify) return [];
  return verify.logs.flatMap((l) =>
    l.level === 'pass' || l.level === 'warn' || l.level === 'fail' || l.level === 'pending'
      ? [{ level: l.level, message: l.message }]
      : [],
  );
}

/** First failure anywhere in the run. */
export function firstFailure(view: RunView): (Failure & { step?: string }) | undefined {
  const s = view.steps.find((x) => x.failure && x.state === 'failed');
  if (s?.failure) return { ...s.failure, step: s.title };
  return view.failure;
}

/** Percentage of declared steps finished, or null before the plan is known. */
export function stepPercent(view: RunView): number | null {
  if (!view.stepsTotal) return null;
  return Math.min(100, Math.round((view.stepsDone / view.stepsTotal) * 100));
}

/** Human-readable size for byte counters (the model download). */
export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} kB`;
  return `${n} B`;
}

/** Lines of the installer's "Next steps" that tell the customer where things are. */
export function nextStepLines(output: string[]): string[] {
  const keys = /(Admin:|Credentials:|Core node must use|Re-check any time:)/;
  return output.flatMap((line) => {
    const m = keys.exec(line);
    return m
      ? [
          line
            .slice(m.index)
            .replace(/\s{2,}/g, ' ')
            .trim(),
        ]
      : [];
  });
}

/** Was this run stopped by Cancel? */
export function wasCancelled(view: RunView): boolean {
  return view.result === 'cancelled' && (view.rollback?.reason ?? 'cancelled') === 'cancelled';
}

/** Rollback items the user must look at: failures and steps that need a manual action. */
export function rollbackAttention(rb: RollbackView | undefined): RollbackItem[] {
  if (!rb) return [];
  return rb.items.filter(
    (i) => i.result === 'failed' || (i.result === 'skipped' && i.label === 'Manual step'),
  );
}
