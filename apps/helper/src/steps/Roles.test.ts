import { describe, expect, it } from 'vitest';
import { aiNodeProblem, type TestedAiNode } from './Roles';
import type { SetupAnswers } from '../api';

const a = (roles: string[], ai_url: string | null) =>
  ({ roles, ai_url }) as unknown as SetupAnswers;
const url = 'http://192.0.2.1:11434';
const ok: TestedAiNode = { url, typed: url, reachable: true, models: ['fake:model'] };

describe('aiNodeProblem', () => {
  it('asks for nothing when the AI runs here or there is no core', () => {
    expect(aiNodeProblem(a(['ai', 'core'], null), null)).toBeNull();
    expect(aiNodeProblem(a(['desktop'], null), null)).toBeNull();
  });
  it('needs a test of the address typed now', () => {
    expect(aiNodeProblem(a(['core'], url), null)).toMatch(/Test the connection/);
    expect(aiNodeProblem(a(['core'], 'http://192.0.2.2:11434'), ok)).toMatch(/Test the connection/);
  });
  it('reports what the test found', () => {
    expect(aiNodeProblem(a(['core'], url), { ...ok, reachable: false, models: [] })).toMatch(
      /does not answer/,
    );
    expect(aiNodeProblem(a(['core'], url), { ...ok, models: [] })).toMatch(/no|not serve/);
    expect(aiNodeProblem(a(['core'], url), ok)).toBeNull();
  });
});
