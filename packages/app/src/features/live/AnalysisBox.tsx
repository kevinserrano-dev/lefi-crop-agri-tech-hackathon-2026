import { useQuery } from '@tanstack/react-query';
import { live, liveQueries, type PhotoAnalysis } from '@lefi/api';
import type { Tone } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { stamp } from '../../shared/lib/time';
import { Badge, Button, Icon } from '../../shared/ui';
import { useLiveMutation } from './common';
import styles from './live.module.css';

const LEVEL: Record<'low' | 'medium' | 'high', Tone> = {
  low: 'info',
  medium: 'warn',
  high: 'crit',
};

/** A short badge for a photo's latest analysis: what Lefi AI said, never a person's finding. */
export function AnalysisBadge({ a }: { a?: PhotoAnalysis }) {
  if (!a) return null;
  if (a.status === 'pending') return <Badge tone="info">Lefi AI looking…</Badge>;
  if (a.status !== 'done' || !a.report)
    return (
      <Badge tone="off" title={a.error ?? undefined}>
        Lefi AI: no answer
      </Badge>
    );
  const n = a.report.findings.length;
  if (!a.report.image_usable) return <Badge tone="off">Lefi AI: photo unusable</Badge>;
  return n === 0 ? (
    <Badge tone="ok">Lefi AI: nothing seen</Badge>
  ) : (
    <Badge tone={a.alerts.length ? 'warn' : 'info'}>
      Lefi AI: {n} possible problem{n === 1 ? '' : 's'}
    </Badge>
  );
}

/**
 * What Lefi AI saw in one photo (ADR-088), labelled as Lefi AI's and to be confirmed, with the
 * model that said it. A person may ask for it and say whether it was right.
 */
export function AnalysisBox({ photoId }: { photoId: string }) {
  const platform = usePlatform();
  const q = useQuery(liveQueries.photoAnalyses(platform, [photoId]));
  const ask = useLiveMutation(
    () => live.analysePhoto(platform, photoId),
    (a) => (a.status === 'pending' ? 'Lefi AI is looking at the photo' : (a.error ?? 'Not done')),
  );
  const judge = useLiveMutation(
    (a: { id: string; verdict: 'correct' | 'wrong' }) =>
      live.judgeAnalysis(platform, a.id, a.verdict),
    () => 'Thank you: kept with the analysis',
  );
  const a = q.data?.[0];
  return (
    <section className={styles.analysis} aria-label="Lefi AI on this photo">
      <div className={styles.sectionHead}>
        <h3>
          <Icon name="smart_toy" size={18} /> Lefi AI on this photo
        </h3>
        <Button
          size="sm"
          variant="secondary"
          icon="visibility"
          disabled={ask.isPending || a?.status === 'pending'}
          onClick={() => ask.mutate(undefined)}
        >
          {a ? 'Look again' : 'Ask Lefi AI to look'}
        </Button>
      </div>
      {q.isError ? (
        <p className={styles.error}>{describeError(q.error)}</p>
      ) : !a ? (
        <p className={styles.muted}>Lefi AI has not looked at this photo.</p>
      ) : a.status === 'pending' ? (
        <p className={styles.muted}>Lefi AI is looking at the photo…</p>
      ) : a.status !== 'done' || !a.report ? (
        <p className={styles.muted}>
          No answer ({a.status}): {a.error ?? 'unknown reason'}
        </p>
      ) : (
        <>
          <p className={styles.muted}>
            <Badge tone="info">Lefi AI · to confirm</Badge> {a.model} ·{' '}
            {stamp(a.finished_at ?? a.requested_at)}
            {' · '}
            {a.report.summary}
          </p>
          {!a.report.image_usable ? (
            <p className={styles.muted}>The photo was not usable (dark, blurred or covered).</p>
          ) : a.report.findings.length === 0 ? (
            <p className={styles.muted}>No visible problem reported.</p>
          ) : (
            <ul className={styles.findings}>
              {a.report.findings.map((f, i) => (
                <li key={i}>
                  <Badge tone={LEVEL[f.severity]}>{f.severity}</Badge> <b>{f.label}</b>{' '}
                  <span className={styles.muted}>
                    · Lefi AI says {Math.round(f.confidence * 100)} % sure
                    {a.alerts.includes(f.kind) && ' · alert raised to confirm'}
                  </span>
                  <br />
                  {f.description}
                </li>
              ))}
            </ul>
          )}
          <span className={styles.assign}>
            {a.verdict ? (
              <span className={styles.muted}>
                {a.verdict_by} said Lefi AI was {a.verdict === 'correct' ? 'right' : 'wrong'}.
              </span>
            ) : (
              <>
                <span className={styles.muted}>Was Lefi AI right?</span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="thumb_up"
                  disabled={judge.isPending}
                  onClick={() => judge.mutate({ id: a.id, verdict: 'correct' })}
                >
                  Right
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="thumb_down"
                  disabled={judge.isPending}
                  onClick={() => judge.mutate({ id: a.id, verdict: 'wrong' })}
                >
                  Wrong
                </Button>
              </>
            )}
          </span>
        </>
      )}
    </section>
  );
}
