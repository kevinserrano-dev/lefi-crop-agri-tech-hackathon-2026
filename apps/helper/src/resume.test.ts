import { describe, expect, it } from 'vitest';
import { needsDecision, type InstallSession } from './resume';
import type { SetupAnswers } from './api';

const answers = { roles: ['core'] } as unknown as SetupAnswers;
const s = (state: InstallSession['state'], a: SetupAnswers | null = answers): InstallSession => ({
  state,
  answers: a,
  runs: 1,
});

describe('needsDecision', () => {
  it('asks after an installation that did not end well', () => {
    expect(needsDecision(s('interrupted'))).toBe(true);
    expect(needsDecision(s('failed'))).toBe(true);
    expect(needsDecision(s('still_running'))).toBe(true);
  });
  it('does not ask when there is nothing to decide', () => {
    expect(needsDecision(null)).toBe(false);
    expect(needsDecision(s('none', null))).toBe(false);
    expect(needsDecision(s('ok'))).toBe(false);
  });
  it('cannot offer to continue without the saved answers', () => {
    expect(needsDecision(s('failed', null))).toBe(false);
  });
});
