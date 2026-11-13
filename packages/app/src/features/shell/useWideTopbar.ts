import { useEffect, useState } from 'react';

/** Design breakpoint: the full top bar shows from 1280 px. */
export function useWideTopbar(min = 1280): boolean {
  const query = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(
    () => typeof window === 'undefined' || window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return wide;
}
