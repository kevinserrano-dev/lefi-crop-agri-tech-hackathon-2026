import { Fragment, type ReactNode } from 'react';
import styles from './Markdown.module.css';

/**
 * The small Markdown a language model writes (Lefi AI answers): headings, bullet and numbered
 * lists, bold, italics, inline code, code blocks and simple pipe tables. Rendered as React
 * elements only — never as HTML — so nothing in the text can inject markup or scripts, and links
 * stay plain text (no navigation out of the app, which runs offline).
 */
export function Markdown({ text }: { text: string }) {
  return <div className={styles.md}>{blocks(text.replace(/\r\n?/g, '\n'))}</div>;
}

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'hr' };

const BULLET = /^\s*[-*•+]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function parse(text: string): Block[] {
  const lines = text.split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) body.push(lines[i++]!);
      i++;
      out.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ kind: 'hr' });
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      out.push({ kind: 'h', level: h[1]!.length, text: h[2]! });
      i++;
      continue;
    }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!)) {
      const rows: string[][] = [cells(line)];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) rows.push(cells(lines[i++]!));
      out.push({ kind: 'table', rows });
      continue;
    }
    for (const [re, kind] of [
      [BULLET, 'ul'],
      [NUMBER, 'ol'],
    ] as const) {
      if (re.test(line)) {
        const items: string[] = [];
        while (i < lines.length && (re.test(lines[i]!) || isContinuation(lines[i]!, items))) {
          const m = re.exec(lines[i]!);
          if (m) items.push(m[1]!);
          else items[items.length - 1] += ` ${lines[i]!.trim()}`;
          i++;
        }
        out.push({ kind, items });
        break;
      }
    }
    if (BULLET.test(line) || NUMBER.test(line)) continue;
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !HEADING.test(lines[i]!) &&
      !BULLET.test(lines[i]!) &&
      !NUMBER.test(lines[i]!) &&
      !lines[i]!.trim().startsWith('```')
    )
      para.push(lines[i++]!.trim());
    out.push({ kind: 'p', lines: para });
  }
  return out;
}

/** An indented line right after a list item continues it. */
const isContinuation = (line: string, items: string[]) =>
  items.length > 0 && /^\s{2,}\S/.test(line);

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

function blocks(text: string): ReactNode {
  return parse(text).map((b, i) => {
    switch (b.kind) {
      case 'h':
        return (
          <p key={i} className={b.level <= 2 ? styles.h2 : styles.h3}>
            {inline(b.text)}
          </p>
        );
      case 'ul':
      case 'ol': {
        const List = b.kind;
        return (
          <List key={i} className={styles.list}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </List>
        );
      }
      case 'code':
        return (
          <pre key={i} className={styles.pre}>
            {b.text}
          </pre>
        );
      case 'hr':
        return <hr key={i} className={styles.hr} />;
      case 'table': {
        const [head, ...body] = b.rows;
        return (
          <div key={i} className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {head!.map((c, j) => (
                    <th key={j}>{inline(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k}>{inline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      default:
        return (
          <p key={i} className={styles.p}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
    }
  });
}

// `code`, **bold** / __bold__, *italic* / _italic_, [text](url) → text.
// Underscores count only at word edges, so names like soil_moisture stay as they are.
const INLINE =
  /(`[^`]+`|\*\*[^*]+\*\*|(?<!\w)__[^_]+__(?!\w)|\*[^*\s][^*]*\*|(?<!\w)_[^_\s][^_]*_(?!\w)|\[[^\]]+\]\([^)]*\))/g;

function inline(text: string): ReactNode {
  return text.split(INLINE).map((p, i) => {
    if (!p) return null;
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2)
      return (
        <code key={i} className={styles.code}>
          {p.slice(1, -1)}
        </code>
      );
    if ((p.startsWith('**') && p.endsWith('**')) || (p.startsWith('__') && p.endsWith('__')))
      return <strong key={i}>{inline(p.slice(2, -2))}</strong>;
    if (
      p.length > 2 &&
      ((p.startsWith('*') && p.endsWith('*')) || (p.startsWith('_') && p.endsWith('_')))
    )
      return <em key={i}>{p.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)]*)\)$/.exec(p);
    if (link) return <Fragment key={i}>{link[1]}</Fragment>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}
