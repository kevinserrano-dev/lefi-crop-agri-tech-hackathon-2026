import type { BrainEvent, Unsubscribe } from './types';

type Listener = (e: BrainEvent) => void;

/**
 * One shared Brain WebSocket per window (ADR-010), opened on the first subscription and
 * re-opened with capped back-off. Used by the web platform; in Tauri the socket lives in Rust.
 */
export function createSocketHub(url: () => string) {
  const listeners = new Map<string, Set<Listener>>();
  let ws: WebSocket | null = null;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const total = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);

  function open() {
    ws = new WebSocket(url());
    ws.onopen = () => {
      retry = 0;
    };
    ws.onmessage = (msg) => {
      let event: BrainEvent;
      try {
        event = JSON.parse(String(msg.data)) as BrainEvent;
      } catch {
        return; // malformed frames are dropped, never guessed at
      }
      listeners.get(event.topic)?.forEach((cb) => cb(event));
      listeners.get('*')?.forEach((cb) => cb(event));
    };
    ws.onclose = () => {
      ws = null;
      if (total() === 0) return;
      const delay = Math.min(30_000, 1_000 * 2 ** retry++);
      timer = setTimeout(open, delay);
    };
  }

  return function subscribe(topic: string, cb: Listener): Unsubscribe {
    let set = listeners.get(topic);
    if (!set) listeners.set(topic, (set = new Set()));
    set.add(cb);
    if (!ws && !timer) open();
    return () => {
      set.delete(cb);
      if (total() === 0) {
        clearTimeout(timer);
        timer = undefined;
        ws?.close();
        ws = null;
      }
    };
  };
}
