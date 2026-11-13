import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The join/home page served by `lefi-helperd main` is plain HTML with an inline script, outside
// TypeScript and ESLint. A syntax error there left every satellite on "Loading…" (0.3.1 to 0.7.1).
const html = readFileSync(
  // Under jsdom, import.meta.url is not a file: URL, so build a plain path instead.
  resolve(import.meta.dirname, '../helperd/src/setup.html'),
  'utf8',
);

describe('helperd setup page', () => {
  it('has a script that parses', () => {
    const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
    expect(() => new Function(script)).not.toThrow();
  });

  it('defines every view it renders', () => {
    for (const fn of [
      'viewJoin',
      'viewMain',
      'viewHome',
      'viewSetup',
      'viewWork',
      'aiDetail',
      'otherDetail',
    ]) {
      expect(html).toContain(`function ${fn}(`);
    }
  });

  it('says which updates wait for this PC, and how to apply them (ADR-062)', () => {
    const start = html.indexOf('function updatesCard(m)');
    const end = html.indexOf('/* ---- not joined', start);
    type Node = { tag: string; children: unknown[] };
    const h = (tag: string, _p: unknown, ...children: unknown[]): Node => ({ tag, children });
    const text = (n: unknown): string =>
      n === null || n === undefined
        ? ''
        : Array.isArray(n)
          ? n.map(text).join('')
          : typeof n === 'object'
            ? text((n as Node).children)
            : String(n);
    const updatesCard = new Function(
      'h',
      'cmdBox',
      'MAIN_IP',
      'HTTP_PORT',
      `${html.slice(start, end)}; return updatesCard;`,
    )(h, (c: string) => h('pre', null, c), '192.168.8.10', 8790) as (m: unknown) => Node | null;

    expect(updatesCard({ updates: { service: null, desktop: null } })).toBeNull();
    expect(updatesCard({})).toBeNull();

    const both = text(
      updatesCard({
        name: 'lefi-node-1',
        updates: {
          service: { installed: '0.5.9', available: '0.6.0', remote: true },
          desktop: { installed: '0.3.9', available: '0.4.0' },
        },
      }),
    );
    expect(both).toContain('Lefi Crop Helper service 0.5.9 → 0.6.0');
    expect(both).toContain('Lefi Desktop 0.3.9 → 0.4.0');
    expect(both).toContain('Lefi Crop Helper → Apps → lefi-node-1');
    expect(both).not.toContain('update.sh'); // it updates itself: nothing to type on that PC

    const old = text(
      updatesCard({ updates: { service: { installed: '0.5.6', available: '0.5.9', remote: false } } }),
    );
    expect(old).toContain('curl -fsS http://192.168.8.10:8790/setup/update.sh | sh');
  });
});
