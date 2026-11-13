import { describe, expect, it } from 'vitest';
import type { InstallerEvent } from './api';
import {
  applyMsg,
  checkLines,
  emptyRun,
  firstFailure,
  fromEvents,
  nextStepLines,
  rollbackAttention,
  stepPercent,
  wasCancelled,
} from './progress';

// Shapes copied from scripts/lib/common.sh (ev_emit / plan_start / step_* / plan_done); fake values.
let seq = 0;
const ev = (event: string, fields: Record<string, unknown> = {}): InstallerEvent => ({
  event,
  seq: ++seq,
  ts: '2026-01-01T00:00:00Z',
  ...fields,
});
const plan = ev('plan.started', {
  mode: 'install',
  dry_run: false,
  roles: 'ai,core',
  steps_total: 3,
  steps: [
    { id: 'scan', title: 'Scan this machine' },
    { id: 'ai.model', title: 'Download the model' },
    { id: 'verify', title: 'Verify the installation' },
  ],
});

describe('installer event reducer', () => {
  it('declares every step up front and counts only finished steps', () => {
    let v = fromEvents([plan]);
    expect(v.steps.map((s) => s.state)).toEqual(['pending', 'pending', 'pending']);
    expect(stepPercent(v)).toBe(0);
    v = fromEvents([
      plan,
      ev('step.started', { step: 'scan', steps_done: 0, steps_total: 3 }),
      ev('step.ok', { step: 'scan', steps_done: 1, steps_total: 3 }),
      ev('step.started', { step: 'ai.model', steps_done: 1, steps_total: 3 }),
      ev('step.progress', { step: 'ai.model', done: 500, total: 1000, unit: 'bytes' }),
    ]);
    expect(v.steps[0]!.state).toBe('ok');
    expect(v.steps[1]!.state).toBe('running');
    expect(v.steps[1]!.progress).toEqual({ done: 500, total: 1000, unit: 'bytes' });
    expect(stepPercent(v)).toBe(33);
  });

  it('keeps skipped reasons, failures and check lines', () => {
    const v = fromEvents([
      plan,
      ev('step.ok', { step: 'scan', skipped: true, reason: 'already done', steps_done: 1 }),
      ev('step.started', { step: 'verify' }),
      ev('step.log', { step: 'verify', level: 'pass', message: 'Ollama responding' }),
      ev('step.log', { step: 'verify', level: 'info', message: 'not a check' }),
      ev('step.log', { step: 'verify', level: 'fail', message: 'Model not on GPU' }),
      ev('step.failed', {
        step: 'verify',
        code: 'AI_NOT_VIABLE',
        message: 'no GPU',
        hint: 'use another PC',
      }),
      ev('plan.done', {
        result: 'failed',
        steps_done: 2,
        steps_total: 3,
        checks: { pass: 1, warn: 0, fail: 1, pending: 0 },
      }),
    ]);
    expect(v.steps[0]).toMatchObject({ state: 'skipped', reason: 'already done' });
    expect(checkLines(v)).toEqual([
      { level: 'pass', message: 'Ollama responding' },
      { level: 'fail', message: 'Model not on GPU' },
    ]);
    expect(firstFailure(v)).toMatchObject({
      code: 'AI_NOT_VIABLE',
      step: 'Verify the installation',
    });
    expect(v.result).toBe('failed');
    expect(v.checks?.fail).toBe(1);
  });

  it('records a failure outside any step at run level', () => {
    const v = fromEvents([
      ev('step.failed', { step: '', code: 'ANSWERS_INVALID', message: 'bad', hint: '' }),
    ]);
    expect(v.failure?.code).toBe('ANSWERS_INVALID');
  });

  it('caps human output and ignores unknown events', () => {
    let v = emptyRun;
    for (let i = 0; i < 3005; i++) v = applyMsg(v, { kind: 'output', line: `l${i}` });
    expect(v.output).toHaveLength(3000);
    expect(v.output.at(-1)).toBe('l3004');
    expect(applyMsg(v, { kind: 'event', event: ev('something.new') })).toBe(v);
  });

  it('extracts the next-step lines from the installer output', () => {
    expect(
      nextStepLines([
        '  ℹ Credentials:  /tmp/fake/credentials/ (admin)',
        'noise',
        '  ℹ Re-check any time:  lefi check',
      ]),
    ).toEqual(['Credentials: /tmp/fake/credentials/ (admin)', 'Re-check any time: lefi check']);
  });

  it('follows a cancel: cancelled step, rollback items, final result', () => {
    const v = fromEvents([
      plan,
      ev('step.started', { step: 'ai.model', steps_done: 1, steps_total: 3 }),
      ev('step.failed', {
        step: 'ai.model',
        code: 'CANCELLED',
        message: 'Cancelled by the user',
        hint: '',
      }),
      ev('rollback.started', { reason: 'cancelled', items_total: 3, journal: '/fake/run.tsv' }),
      ev('rollback.item', {
        index: 1,
        items_total: 3,
        action: 'model_pulled',
        label: 'Delete model fake:1b',
        result: 'ok',
        message: '',
      }),
      ev('rollback.item', {
        index: 2,
        items_total: 3,
        action: 'manual',
        label: 'Manual step',
        result: 'skipped',
        message: 'Homebrew was kept',
      }),
      ev('rollback.item', {
        index: 3,
        items_total: 3,
        action: 'pkgs_added',
        label: 'Uninstall fake',
        result: 'failed',
        message: 'brew not found',
      }),
      ev('rollback.done', {
        result: 'partial',
        ok: 1,
        failed: 1,
        skipped: 1,
        report: '/tmp/fake-report',
      }),
      ev('plan.done', { result: 'cancelled', steps_done: 1, steps_total: 3 }),
    ]);
    expect(v.steps[1]!.state).toBe('cancelled');
    expect(firstFailure(v)).toBeUndefined();
    expect(wasCancelled(v)).toBe(true);
    expect(v.rollback).toMatchObject({
      total: 3,
      result: 'partial',
      failed: 1,
      report: '/tmp/fake-report',
    });
    expect(v.rollback!.items).toHaveLength(3);
    expect(rollbackAttention(v.rollback).map((i) => i.result)).toEqual(['skipped', 'failed']);
  });
});
