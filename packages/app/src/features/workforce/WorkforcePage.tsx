import { useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { ActionButton, useToast } from '../../shared/ui';
import { useCan } from '../session';
import { DirectoryTab } from './DirectoryTab';
import { InviteDialog } from './InviteDialog';
import { ShiftsTab } from './ShiftsTab';
import styles from './workforce.module.css';

type Tab = 'directory' | 'shifts';
const TABS: Array<[Tab, string]> = [
  ['directory', 'Employee directory'],
  ['shifts', 'Shifts & availability'],
];

/** Workforce (design): directory with profile, and the weekly shift roster. */
export function WorkforcePage() {
  const search = useSearch({ strict: false }) as { tab?: Tab; person?: string };
  const [tab, setTab] = useState<Tab>(search.tab === 'shifts' ? 'shifts' : 'directory');
  const [seen, setSeen] = useState(search.tab ?? search.person);
  if ((search.tab ?? search.person) !== seen) {
    setSeen(search.tab ?? search.person);
    setTab(search.tab === 'shifts' ? 'shifts' : 'directory');
  }
  const [inviting, setInviting] = useState(false);
  const canManage = useCan('user.manage');
  const toast = useToast((s) => s.show);
  const reason = 'Only System Administrators can invite users.';
  return (
    <>
      <div className={styles.tabBar}>
        <div className={styles.tabs} role="tablist" aria-label="Workforce">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <ActionButton
          label="Invite user"
          icon="person_add"
          variant="solid"
          availability={{ allowed: canManage, reason: canManage ? null : reason }}
          onClick={() => (canManage ? setInviting(true) : toast(reason, 'bad'))}
        />
      </div>
      {tab === 'directory' ? <DirectoryTab /> : <ShiftsTab />}
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
    </>
  );
}
