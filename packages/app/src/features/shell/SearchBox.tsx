import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBrainKind } from './useBrainKind';
import { useNavigate } from '@tanstack/react-router';
import { queries } from '@lefi/api';
import type { ScreenDef } from '../../app/screen';
import { usePlatform } from '../../platform/PlatformContext';
import { Icon } from '../../shared/ui';
import styles from './shell.module.css';

interface Hit {
  key: string;
  icon: string;
  label: string;
  sub: string;
  kind: string;
  to: string;
  search?: Record<string, string>;
}

/** Debounce a value so the Brain is queried after the user pauses typing. */
function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/**
 * Top-bar search (⌘K / Ctrl+K): screens, plus zones, devices, batches, plants, incidents,
 * tasks and people from the Brain's search — only what the user may open.
 */
export function SearchBox({ screens, compact }: { screens: ScreenDef[]; compact: boolean }) {
  const navigate = useNavigate();
  const platform = usePlatform();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setExpanded(true);
        setOpen(true);
        setTimeout(() => input.current?.focus());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const term = q.trim().toLowerCase();
  const debounced = useDebounced(term, 200);
  const kind = useBrainKind();
  const search = queries.search(platform, debounced);
  const brain = useQuery({
    ...search,
    enabled: search.enabled !== false && kind.serves('/search'),
  });
  const screenHits: Hit[] = term
    ? screens
        .filter((s) => `${s.label} ${s.title}`.toLowerCase().includes(term))
        .slice(0, 4)
        .map((s) => ({
          key: `screen:${s.id}`,
          icon: s.icon,
          label: s.title,
          sub: '',
          kind: 'Screen',
          to: s.path,
        }))
    : [];
  const brainHits: Hit[] =
    debounced === term
      ? (brain.data ?? []).map((h) => ({
          key: `${h.kind}:${h.id}`,
          icon: h.icon,
          label: h.label,
          sub: h.sub,
          kind: h.kind,
          to: h.to,
          search: h.search,
        }))
      : [];
  const hits = [...screenHits, ...brainHits];

  const go = (h: Hit) => {
    setQ('');
    setOpen(false);
    setExpanded(false);
    input.current?.blur();
    void navigate({ to: h.to, search: h.search ?? {} });
  };

  if (compact && !expanded) {
    return (
      <button
        type="button"
        title="Search (⌘K)"
        aria-label="Search"
        className={styles.iconBtn}
        onClick={() => {
          setExpanded(true);
          setOpen(true);
          setTimeout(() => input.current?.focus());
        }}
      >
        <Icon name="search" size={20} />
      </button>
    );
  }

  const searching = term.length >= 2 && (debounced !== term || brain.isFetching);
  return (
    <div className={styles.searchWrap}>
      <div className={styles.search}>
        <Icon name="search" size={19} />
        <input
          ref={input}
          value={q}
          placeholder="Search plants, zones, devices…"
          aria-label="Search"
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() =>
            setTimeout(() => {
              setOpen(false);
              setExpanded(false);
            }, 150)
          }
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, hits.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === 'Enter' && hits[active]) go(hits[active]);
            if (e.key === 'Escape') input.current?.blur();
          }}
        />
        <span className={styles.kbd}>⌘K</span>
      </div>
      {open && term && (
        <div className={styles.searchPop} role="listbox" aria-label="Search results">
          {hits.map((h, i) => (
            <button
              key={h.key}
              type="button"
              role="option"
              aria-selected={i === active}
              className={styles.searchHit}
              onMouseEnter={() => setActive(i)}
              onMouseDown={() => go(h)}
            >
              <Icon name={h.icon} size={18} />
              <span className={styles.searchHitText}>
                <b>{h.label}</b>
                {h.sub && <span>{h.sub}</span>}
              </span>
              <span className={styles.searchKind}>{h.kind}</span>
            </button>
          ))}
          {hits.length === 0 && (
            <div className={styles.searchEmpty}>
              {searching ? 'Searching…' : term.length < 2 ? 'Keep typing…' : 'Nothing matches.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
