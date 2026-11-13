import { Link, useRouterState } from '@tanstack/react-router';
import { logos } from '@lefi/ui';
import type { ScreenDef } from '../../app/screen';
import { Avatar, CountBadge, Icon } from '../../shared/ui';
import { useLogout, useSession } from '../session';
import type { NavBadges } from './useNavBadges';
import styles from './shell.module.css';

export interface SidebarProps {
  screens: ScreenDef[];
  badges: NavBadges;
  collapsed: boolean;
}

export function Sidebar({ screens, badges, collapsed }: SidebarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: session } = useSession();
  const logout = useLogout();

  const groups = new Map<string, ScreenDef[]>();
  for (const s of screens) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);

  return (
    <aside className={styles.sidebar} data-collapsed={collapsed}>
      <div className={styles.brand}>
        <img src={logos.mark} alt="" className={styles.brandMark} />
        {!collapsed && (
          <div className={styles.brandText}>
            <img src={logos.wordmark} alt="Lefi Crop" className={styles.wordmark} />
            <span>AI-Powered Greenhouse Operations</span>
          </div>
        )}
      </div>

      <nav className={styles.nav} aria-label="Main">
        {[...groups].map(([group, items]) => (
          <div key={group} className={styles.navGroup}>
            {!collapsed && <div className={styles.navGroupLabel}>{group}</div>}
            {items.map((s) => {
              const active = s.path === '/' ? pathname === '/' : pathname.startsWith(s.path);
              const badge = badges[s.id];
              return (
                <Link
                  key={s.id}
                  to={s.path}
                  title={s.label}
                  className={styles.navItem}
                  data-active={active}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon name={s.icon} size={21} filled={active} className={styles.navIcon} />
                  {!collapsed && (
                    <>
                      <span className={styles.navLabel}>{s.label}</span>
                      {badge && badge.count !== 0 && (
                        <CountBadge tone={badge.tone} count={badge.count} />
                      )}
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {session && (
        <div className={styles.me}>
          <Avatar name={session.user.display_name} />
          {!collapsed && (
            <>
              <div className={styles.meText}>
                <span className={styles.meName}>{session.user.display_name}</span>
                <span className={styles.meRole}>{session.role.name}</span>
              </div>
              <button
                type="button"
                title="Sign out"
                className={styles.iconBtnPlain}
                onClick={() => logout.mutate()}
              >
                <Icon name="logout" size={20} />
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
