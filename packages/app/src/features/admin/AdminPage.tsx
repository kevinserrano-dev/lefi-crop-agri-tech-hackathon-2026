import { useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useCan } from '../session';
import { AuditTab } from './AuditTab';
import { ConfigTab } from './ConfigTab';
import { RegistryTab } from './RegistryTab';
import { RolesTab } from './RolesTab';
import styles from './admin.module.css';

type Tab = 'roles' | 'devices' | 'config' | 'audit';
const TABS: Array<{ id: Tab; label: string; permission: string }> = [
  { id: 'roles', label: 'Roles & permissions', permission: 'admin.roles' },
  { id: 'devices', label: 'Device & sensor registry', permission: 'admin.devices' },
  { id: 'config', label: 'System configuration', permission: 'admin.config' },
  { id: 'audit', label: 'Audit trail', permission: 'admin.audit' },
];

/** Administration (design): each tab is shown only if the session holds its permission. */
export function AdminPage() {
  const allowed = {
    roles: useCan('admin.roles'),
    devices: useCan('admin.devices'),
    config: useCan('admin.config'),
    audit: useCan('admin.audit'),
  };
  const visible = TABS.filter((t) => allowed[t.id]);
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const [picked, setPicked] = useState<Tab | undefined>(search.tab);
  const [seen, setSeen] = useState(search.tab);
  if (search.tab !== seen) {
    setSeen(search.tab);
    if (search.tab) setPicked(search.tab);
  }
  const tab = visible.find((t) => t.id === picked)?.id ?? visible[0]?.id;
  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label="Administration">
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setPicked(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'roles' && <RolesTab />}
      {tab === 'devices' && <RegistryTab />}
      {tab === 'config' && <ConfigTab />}
      {tab === 'audit' && <AuditTab />}
      {!tab && <span className={styles.text}>Your role has no administration views.</span>}
    </>
  );
}
