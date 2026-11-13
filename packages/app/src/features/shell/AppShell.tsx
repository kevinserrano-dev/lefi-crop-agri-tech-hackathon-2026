import { Navigate, Outlet, useRouterState } from '@tanstack/react-router';
import type { ScreenDef } from '../../app/screen';
import { isUnauthorized } from '../../shared/lib/errors';
import { ToastViewport } from '../../shared/ui';
import { useSession } from '../session';
import { AiStoppedBanner, ConnectionBanner } from './ConnectionBanner';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useBrainStatus } from './useBrainStatus';
import { useNavBadges } from './useNavBadges';
import { useUiStore } from './uiStore';
import { LefiAssistant } from './LefiAssistant';
import styles from './shell.module.css';

/** Authenticated layout: sidebar + top bar + routed page. */
export function AppShell({ screens }: { screens: ScreenDef[] }) {
  const session = useSession();
  const brain = useBrainStatus();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const badges = useNavBadges();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (session.isPending) return <div className={styles.splash}>Connecting to Lefi Brain…</div>;
  // No session yet, or it ended: the sign-in page explains what is missing if the Brain is away.
  // A failed re-check with a session in hand keeps the app open, with the "connection lost" banner.
  // A temporary password must be changed first; the sign-in page asks for it (the Brain enforces it).
  if (
    !session.data ||
    session.data.must_change_password ||
    (session.isError && isUnauthorized(session.error))
  ) {
    return <Navigate to="/login" />;
  }

  const visible = screens.filter((s) => session.data.permissions.includes(s.permission));
  const current =
    screens.find((s) => (s.path === '/' ? pathname === '/' : pathname.startsWith(s.path))) ??
    screens[0];

  return (
    <div className={styles.layout}>
      <Sidebar screens={visible} badges={badges} collapsed={collapsed} />
      <div className={styles.column}>
        <Topbar
          title={current?.title ?? ''}
          subtitle={current?.subtitle ?? ''}
          status={brain.data}
          screens={visible}
          onToggleSidebar={toggle}
        />
        <main className={styles.main}>
          {!brain.connected && <ConnectionBanner lastContact={brain.brainTime} />}
          {brain.data?.ai.kill_switch && <AiStoppedBanner ai={brain.data.ai} />}
          <Outlet />
        </main>
        <LefiAssistant />
        <ToastViewport />
      </div>
    </div>
  );
}
