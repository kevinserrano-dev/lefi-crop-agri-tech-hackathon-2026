import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  people,
  peopleQueries,
  type BrainRole,
  type BrainUserDetail,
  type BrainUserPatch,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { roleColor } from '../../shared/lib/roles';
import { stamp, timeAgo } from '../../shared/lib/time';
import { Avatar, Button, Icon, Skeleton } from '../../shared/ui';
import { ConfirmButton, useBrainNow } from '../live/common';
import { Facts, UserBadges, isLocked, usePeopleMutation } from './common';
import { actionLabel } from './presentation';
import styles from './people.module.css';

type Shown = { username: string; password: string; title: string };

/** One person as Lefi Brain knows them, and what an administrator may change. */
export function UserPanel({
  id,
  canManage,
  roles,
  onPassword,
}: {
  id: string;
  canManage: boolean;
  roles: BrainRole[];
  onPassword: (s: Shown) => void;
}) {
  const platform = usePlatform();
  const now = useBrainNow();
  const q = useQuery(peopleQueries.user(platform, id));
  if (q.isError) return <span className={styles.muted}>{describeError(q.error)}</span>;
  if (!q.data) return <Skeleton height={480} />;
  const u = q.data;
  const locked = isLocked(u, now);
  return (
    <aside className={styles.panel} aria-label={`${u.display_name} profile`}>
      <div className={styles.head}>
        <Avatar name={u.display_name} size={56} color={roleColor(u.role.id)} />
        <div className={styles.headText}>
          <span className={styles.name}>
            {u.display_name}
            {u.is_you && <span className={styles.muted}> (you)</span>}
          </span>
          <span className={styles.muted}>
            {u.username}
            {u.email ? ` · ${u.email}` : ''}
          </span>
          <UserBadges user={u} brainNow={now} />
        </div>
      </div>

      <Facts
        items={[
          ['Role', u.role.name],
          ['Last sign-in', timeAgo(u.last_login_at, now)],
          [
            'Signed in now',
            `${u.active_sessions} ${u.active_sessions === 1 ? 'session' : 'sessions'}`,
          ],
          ['Account created', stamp(u.created_at)],
        ]}
      />

      {canManage && <ManageUser u={u} roles={roles} locked={locked} onPassword={onPassword} />}

      <div className={styles.block}>
        <span className={styles.label}>
          What a {u.role.short} can do ({u.permissions.length} permissions)
        </span>
        <div className={styles.chips}>
          {u.permissions.map((p) => (
            <span key={p} className={styles.perm}>
              {p}
            </span>
          ))}
        </div>
      </div>

      {u.sessions && (
        <div className={styles.block}>
          <span className={styles.label}>Signed-in sessions</span>
          {u.sessions.length === 0 && <span className={styles.muted}>None right now.</span>}
          {u.sessions.map((s) => (
            <div key={s.id} className={styles.row}>
              <Icon name="devices" size={16} />
              <span>
                {s.ip ?? 'unknown address'} · since {stamp(s.created_at)} · active{' '}
                {timeAgo(s.last_seen_at, now)}
                {s.current && <b> · this session</b>}
              </span>
            </div>
          ))}
        </div>
      )}

      {u.recent && (
        <div className={styles.block}>
          <span className={styles.label}>Recent changes (audit trail)</span>
          {u.recent.length === 0 && <span className={styles.muted}>No changes recorded.</span>}
          {u.recent.map((r) => (
            <div key={`${r.at}-${r.action}`} className={styles.row}>
              <span className={styles.mono}>{stamp(r.at)}</span>
              <span>
                {actionLabel(r.action)}
                {r.outcome !== 'success' && <b className={styles.denied}> · {r.outcome}</b>}
                <span className={styles.muted}> · by {r.by}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function ManageUser({
  u,
  roles,
  locked,
  onPassword,
}: {
  u: BrainUserDetail;
  roles: BrainRole[];
  locked: boolean;
  onPassword: (s: Shown) => void;
}) {
  const platform = usePlatform();
  const [name, setName] = useState(u.display_name);
  const [email, setEmail] = useState(u.email ?? '');
  const update = usePeopleMutation(
    (body: BrainUserPatch) => people.updateUser(platform, u.id, body),
    (r) => `${r.display_name} saved.`,
  );
  const reset = usePeopleMutation(() => people.resetPassword(platform, u.id));
  const revoke = usePeopleMutation(
    () => people.revokeSessions(platform, u.id),
    (r) => (r.revoked === 1 ? '1 session ended.' : `${r.revoked} sessions ended.`),
  );
  const unlock = usePeopleMutation(
    () => people.unlock(platform, u.id),
    (r) => `${r.display_name} can sign in again.`,
  );
  const selfReason = 'Ask another administrator: you cannot change your own role or status.';
  const dirty = name !== u.display_name || email !== (u.email ?? '');
  return (
    <div className={styles.block}>
      <span className={styles.label}>Manage</span>
      <div className={styles.grid2}>
        <label className={styles.field}>
          Full name
          <input value={name} maxLength={128} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={styles.field}>
          Email
          <input
            type="email"
            value={email}
            maxLength={255}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      </div>
      {dirty && (
        <div className={styles.actions}>
          <Button
            size="sm"
            icon="save"
            disabled={update.isPending}
            onClick={() => update.mutate({ display_name: name, email })}
          >
            Save name and email
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setName(u.display_name);
              setEmail(u.email ?? '');
            }}
          >
            Undo
          </Button>
        </div>
      )}
      <label className={styles.field}>
        Role
        <select
          key={u.role.id}
          defaultValue={u.role.id}
          disabled={u.is_you || update.isPending}
          title={u.is_you ? selfReason : 'Changing the role signs the person out everywhere'}
          onChange={(e) => update.mutate({ role: e.target.value as BrainUserPatch['role'] })}
        >
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {u.is_you ? (
        <span className={styles.muted}>{selfReason}</span>
      ) : (
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            icon="key"
            disabled={reset.isPending}
            onClick={() =>
              reset.mutate(undefined, {
                onSuccess: (r) =>
                  r.temporary_password &&
                  onPassword({
                    username: r.user.username,
                    password: r.temporary_password,
                    title: `New temporary password for ${r.user.display_name}`,
                  }),
              })
            }
          >
            Reset password
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="logout"
            disabled={revoke.isPending || u.active_sessions === 0}
            onClick={() => revoke.mutate(undefined)}
          >
            End sessions
          </Button>
          {locked && (
            <Button
              size="sm"
              variant="secondary"
              icon="lock_open"
              disabled={unlock.isPending}
              onClick={() => unlock.mutate(undefined)}
            >
              Unlock
            </Button>
          )}
          {u.status === 'active' ? (
            <ConfirmButton
              label="Deactivate"
              icon="person_off"
              confirm="Signs them out and blocks sign-in."
              disabled={update.isPending}
              onConfirm={() => update.mutate({ status: 'disabled' })}
            />
          ) : (
            <Button
              size="sm"
              icon="person_check"
              disabled={update.isPending}
              onClick={() => update.mutate({ status: 'active' })}
            >
              Reactivate
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
