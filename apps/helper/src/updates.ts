/** Updates (ADR-035): src-tauri/src/updates.rs. Lefi Crop Helper is the only updater. */
import { invoke } from '@tauri-apps/api/core';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

export interface ReleaseManifest {
  release: string;
  released_at: string;
  security: boolean;
  notes: string;
  components: {
    helper: string;
    helperd: string;
    brain: string;
    desktop: string | null;
    installer: string;
  };
}

export interface UpdateFile {
  path: string;
  manifest: ReleaseManifest | null;
  problem: string | null;
  problem_code: string | null;
}

export interface ComponentUpdate {
  component: 'desktop' | 'brain';
  installed: string;
  available: string;
  outdated: boolean;
}

export interface UpdatesStatus {
  release: string;
  helper: string;
  packaged: boolean;
  support_until: string | null;
  installed: { brain: string | null; desktop: { path: string; version: string } | null };
  bundled: { brain: string | null; desktop: string | null };
  components: ComponentUpdate[];
  files: UpdateFile[];
  release_key_embedded: boolean;
}

export interface UpdateSettings {
  auto_components: boolean;
}

export const updatesApi = {
  status: () => invoke<UpdatesStatus>('updates_status'),
  applyHelper: (path: string) => invoke<{ release: string }>('apply_helper_update', { path }),
  settings: () => invoke<UpdateSettings>('update_settings'),
  setSettings: (settings: UpdateSettings) =>
    invoke<UpdateSettings>('set_update_settings', { settings }),
};

/** What deserves the operator's attention now (installable files + outdated components). */
export function pending(s: UpdatesStatus): { key: string; title: string; body: string }[] {
  const out: { key: string; title: string; body: string }[] = [];
  for (const f of s.files) {
    if (f.manifest && !f.problem)
      out.push({
        key: `release:${f.manifest.release}`,
        title: f.manifest.security
          ? `Security update: Lefi Crop ${f.manifest.release}`
          : `Lefi Crop ${f.manifest.release} is available`,
        body: 'Open Lefi Crop Helper → Settings → Updates to review and install it.',
      });
  }
  for (const c of s.components)
    if (c.outdated)
      out.push({
        key: `${c.component}:${c.available}`,
        title: c.component === 'desktop' ? 'Lefi Desktop update ready' : 'Lefi Brain update ready',
        body:
          c.component === 'desktop'
            ? `${c.installed} → ${c.available}. Update it with one click in Lefi Crop Helper → Apps.`
            : `${c.installed} → ${c.available}. Approve it in Lefi Crop Helper → Settings → Updates.`,
      });
  return out;
}

const SEEN = 'lefi-helper.notified';

/** macOS notification once per pending item (remembered per viewer; failures are harmless). */
export async function notifyNew(s: UpdatesStatus): Promise<void> {
  let seen: string[] = [];
  try {
    seen = JSON.parse(localStorage.getItem(SEEN) ?? '[]') as string[];
  } catch {
    seen = [];
  }
  const fresh = pending(s).filter((p) => !seen.includes(p.key));
  if (!fresh.length) return;
  try {
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === 'granted';
    if (ok) for (const p of fresh) sendNotification({ title: p.title, body: p.body });
  } catch {
    return;
  }
  try {
    localStorage.setItem(SEEN, JSON.stringify([...seen, ...fresh.map((p) => p.key)]));
  } catch {
    /* storage unavailable: may notify again later */
  }
}

/** `a` is a newer version than `b` (numeric `major.minor.patch`, like the Rust side). Unknown: no. */
export function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  const parse = (v: string | null | undefined) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec((v ?? '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}
