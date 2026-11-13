import type { SystemStatus } from '@lefi/api';
import type { ScreenDef } from '../../app/screen';
import { Icon } from '../../shared/ui';
import { clock, longDate } from '../../shared/lib/time';
import { NotificationsMenu } from './NotificationsMenu';
import { SearchBox } from './SearchBox';
import { StopAiButton } from './StopAi';
import { ViewAs } from './ViewAs';
import { useWideTopbar } from './useWideTopbar';
import styles from './shell.module.css';

export interface TopbarProps {
  title: string;
  subtitle: string;
  status: SystemStatus | undefined;
  screens: ScreenDef[];
  onToggleSidebar: () => void;
}

export function Topbar({ title, subtitle, status, screens, onToggleSidebar }: TopbarProps) {
  const wide = useWideTopbar();
  return (
    <header className={styles.topbar}>
      <button
        type="button"
        className={styles.iconBtnPlain}
        aria-label="Toggle sidebar"
        onClick={onToggleSidebar}
      >
        <Icon name="dock_to_right" size={22} />
      </button>
      <div className={styles.titleBlock}>
        <span className={styles.pageTitle}>{title}</span>
        <span className={styles.pageSub}>{subtitle}</span>
      </div>
      <SearchBox screens={screens} compact={!wide} />
      {import.meta.env.DEV && status?.mock && <ViewAs wide={wide} />}
      {status?.mock && (
        <span className={styles.mockDot} title="Development mock Brain — all data is fake">
          <Icon name="science" size={17} />
        </span>
      )}
      <StopAiButton ai={status?.ai} wide={wide} />
      <NotificationsMenu brainTime={status?.brain_time} />
      {wide && status && (
        <div className={styles.clock} title="Lefi Brain time">
          <span className={styles.clockDate}>{longDate(status.brain_time)}</span>
          <span className={styles.clockTime}>
            {clock(status.brain_time)}
            {status.outside_temp_c !== null && ` · ${Math.round(status.outside_temp_c)} °C outside`}
          </span>
        </div>
      )}
    </header>
  );
}
