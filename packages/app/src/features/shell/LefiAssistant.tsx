import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  endpoints,
  liveQueries,
  queries,
  queryKeys,
  type AiMessage,
  type AssistantStatus,
} from '@lefi/api';
import { mascots } from '@lefi/ui';
import { usePlatform } from '../../platform/PlatformContext';
import { OPEN_ASSISTANT_EVENT } from '../../shared/lib/assistant';
import { describeError } from '../../shared/lib/errors';
import { Icon, Markdown } from '../../shared/ui';
import { useCan } from '../session';
import { PhotoViewer } from '../live/CameraPanel';
import { useBrainKind } from './useBrainKind';
import styles from './shell.module.css';

const MAX_CHARS = 2000;

/** Lefi's state in a few words, only from what Lefi Brain reported (ADR-067). */
export function moodOf(status: AssistantStatus | undefined, allowed: boolean, served: boolean) {
  if (!served) return 'AI unavailable · Lefi Brain has no AI assistant yet';
  if (!allowed) return 'AI unavailable for your role';
  if (!status) return 'Checking the AI…';
  switch (status.state) {
    case 'available':
      return status.model ? `Ready · ${status.model}` : 'Ready';
    case 'disabled':
      return status.kill_switch ? 'AI stopped (kill switch)' : 'AI turned off';
    case 'unconfigured':
      return 'AI not configured';
    case 'unreachable':
      return 'AI node not reachable';
    case 'model_missing':
      return 'AI model not installed';
  }
}

/** Floating "Ask Lefi" button + chat. Lefi answers only from what Lefi Brain reads for this role. */
export function LefiAssistant() {
  const platform = usePlatform();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const kind = useBrainKind();
  const allowed = useCan('ai.chat');
  const canRobots = useCan('nav.robots');
  const canHandover = useCan('nav.handover');
  const served = kind.serves('/ai/assistant');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);

  const status = useQuery({ ...queries.assistantStatus(platform), enabled: served && allowed });
  const conversation = useQuery({
    ...queries.aiConversation(platform, conversationId ?? ''),
    enabled: !!conversationId && open,
  });
  const ask = useMutation({
    mutationFn: (message: string) =>
      endpoints.chat(platform, {
        message,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }),
    onSuccess: (conv) => {
      qc.setQueryData(queryKeys.aiConversation(conv.id), conv);
      setConversationId(conv.id);
      setDraft('');
    },
    onError: () => void qc.invalidateQueries({ queryKey: queryKeys.assistantStatus }),
  });

  const aiOn = served && allowed && status.data?.state === 'available';
  const messages = conversation.data?.messages ?? [];
  const thinking = messages.some((m) => m.state === 'thinking');
  const img = aiOn ? (thinking ? mascots.thinking : mascots.wink) : mascots.sleeping;
  const dot = aiOn ? 'var(--lefi-ok-dot)' : 'var(--lefi-off-dot)';

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_ASSISTANT_EVENT, show);
    return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, show);
  }, []);

  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, thinking, open]);

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !aiOn || thinking || ask.isPending) return;
    ask.mutate(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) send(e);
  };

  return (
    <div className={styles.fabWrap}>
      {open && (
        <div className={styles.assistant} role="dialog" aria-label="Lefi AI assistant">
          <div className={styles.assistantHead}>
            <img src={img} alt="Lefi" className={styles.assistantImg} />
            <div className={styles.assistantTitle}>
              <span>Lefi · AI assistant</span>
              <span className={styles.assistantMood}>
                <span style={{ background: dot }} />
                {moodOf(status.data, allowed, served)}
              </span>
            </div>
            {conversationId && (
              <button
                type="button"
                className={styles.iconBtnPlain}
                aria-label="New conversation"
                title="New conversation"
                disabled={thinking}
                onClick={() => {
                  setConversationId(null);
                  ask.reset();
                }}
              >
                <Icon name="add_comment" size={20} />
              </button>
            )}
            <button
              type="button"
              className={styles.iconBtnPlain}
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <Icon name="close" size={20} />
            </button>
          </div>

          {!aiOn ? (
            <p className={styles.assistantText}>
              {served && allowed && status.isPending
                ? 'Loading…'
                : `AI reasoning unavailable${
                    status.data?.reason ? `: ${status.data.reason}` : ''
                  }. Monitoring and alerts keep running without it.`}
            </p>
          ) : (
            <div className={styles.chatLog} aria-live="polite">
              {messages.length === 0 && (
                <p className={styles.chatHint}>
                  Ask about your greenhouse: zones, crops, plants, sensor readings
                  {status.data?.tools.some((t) => t.name === 'field_devices') ? ', devices' : ''}
                  {status.data?.tools.some((t) => t.name === 'cameras') ? ', cameras' : ''}.
                  {status.data?.tools.some((t) => t.name === 'camera_photo')
                    ? ' Lefi only reads what your role can see; the only things it can do are take photos and aim the cameras a person allowed.'
                    : ' Lefi only reads what your role can see and cannot change anything.'}
                </p>
              )}
              {messages.map((m) => (
                <ChatMessage key={m.id} m={m} />
              ))}
              <div ref={bottom} />
            </div>
          )}

          {ask.isError && (
            <p className={styles.chatError} role="alert">
              {describeError(ask.error)}
            </p>
          )}

          {aiOn && (
            <form className={styles.chatForm} onSubmit={send}>
              <textarea
                aria-label="Ask Lefi"
                placeholder={thinking ? 'Lefi is answering…' : 'Ask Lefi…'}
                value={draft}
                maxLength={MAX_CHARS}
                rows={2}
                disabled={thinking || ask.isPending}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
              />
              <button
                type="submit"
                aria-label="Send"
                className={styles.chatSend}
                disabled={!draft.trim() || thinking || ask.isPending}
              >
                <Icon name="send" size={18} />
              </button>
            </form>
          )}

          {(canRobots || canHandover) && (
            <div className={styles.assistantActions}>
              {canRobots && (
                <button
                  type="button"
                  className={styles.assistantSecondary}
                  onClick={() => {
                    setOpen(false);
                    void navigate({ to: '/robots' });
                  }}
                >
                  Mission Center
                </button>
              )}
              {canHandover && (
                <button
                  type="button"
                  className={styles.assistantSecondary}
                  onClick={() => {
                    setOpen(false);
                    void navigate({ to: '/handover' });
                  }}
                >
                  Shift handover
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        title="Ask Lefi"
        className={styles.fab}
        onClick={() => setOpen((o) => !o)}
      >
        <img src={img} alt="Lefi" />
        <span className={styles.fabDot} style={{ background: dot }} />
      </button>
    </div>
  );
}

function ChatMessage({ m }: { m: AiMessage }) {
  const [viewing, setViewing] = useState<string>();
  if (m.role === 'user') {
    return <div className={styles.chatUser}>{m.content}</div>;
  }
  // Photos Lefi AI took for this answer (ADR-079): shown from Lefi Brain, never described by AI.
  const photoIds = m.tools
    .filter((t) => t.outcome === 'ok' && t.detail?.startsWith('photo:'))
    .map((t) => (t.detail ?? '').slice('photo:'.length));
  const moved = m.tools.some((t) => t.name === 'camera_control' && t.outcome === 'ok');
  const read = m.tools.filter((t) => t.outcome === 'ok').map((t) => t.label);
  const denied = m.tools.filter((t) => t.outcome === 'denied').map((t) => t.label);
  return (
    <div className={styles.chatLefi} data-state={m.state}>
      {m.state === 'thinking' && (
        <span className={styles.chatMuted}>Lefi is reading the data…</span>
      )}
      {m.state === 'failed' && <span className={styles.chatErrorText}>{m.error}</span>}
      {m.state === 'done' && <Markdown text={m.content} />}
      {photoIds.map((id) => (
        <ChatPhoto key={id} id={id} onOpen={() => setViewing(id)} />
      ))}
      {moved && (
        <span className={styles.chatSource}>
          Lefi moved a camera for you · see Devices &amp; Health → the camera → Commands sent
        </span>
      )}
      <PhotoViewer photoId={viewing} onClose={() => setViewing(undefined)} />
      {m.state !== 'thinking' && (
        <span className={styles.chatSource}>
          AI answer{m.model ? ` · ${m.model}` : ''}
          {read.length > 0 && ` · read: ${[...new Set(read)].join(', ')}`}
          {denied.length > 0 && ` · not allowed for your role: ${[...new Set(denied)].join(', ')}`}
        </span>
      )}
    </div>
  );
}

/** A photo Lefi AI took, as Lefi Brain stored it. */
function ChatPhoto({ id, onOpen }: { id: string; onOpen: () => void }) {
  const platform = usePlatform();
  const photo = useQuery(liveQueries.cameraPhoto(platform, id));
  if (photo.isError)
    return <span className={styles.chatErrorText}>{describeError(photo.error)}</span>;
  if (!photo.data) return <span className={styles.chatMuted}>Loading the photo…</span>;
  const p = photo.data;
  return (
    <button type="button" className={styles.chatPhoto} onClick={onOpen} title="Open the photo">
      <img
        src={`data:image/jpeg;base64,${p.jpeg_base64}`}
        alt={p.note ?? `Photo from ${p.camera_id}`}
      />
      <span>
        {p.camera_id} · {new Date(p.taken_at).toLocaleTimeString([], { hour12: false })} · LIVE
        {p.note ? ` · ${p.note}` : ''}
      </span>
    </button>
  );
}
