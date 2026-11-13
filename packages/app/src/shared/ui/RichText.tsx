import { Fragment } from 'react';

/** Renders `**bold**` segments only. Anything else stays plain text (no HTML injection). */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <b key={i}>{p.slice(2, -2)}</b>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}
