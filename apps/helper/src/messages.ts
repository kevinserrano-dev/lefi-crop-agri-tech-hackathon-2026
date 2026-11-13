/**
 * Lefi Crop Helper UI strings — English only (owner decision Q2), kept in one file so a language can
 * be added later. Lefi's lines are fixed scripts: no AI runs during setup (INSTALLER.md §1.2).
 */
import type { MascotState } from '@lefi/ui';

export type StepId =
  'welcome' | 'activation' | 'scan' | 'roles' | 'plan' | 'install' | 'verify' | 'finish';

export const STEPS: Array<{ id: StepId; label: string; icon: string }> = [
  { id: 'welcome', label: 'Welcome', icon: 'waving_hand' },
  { id: 'activation', label: 'Activation', icon: 'key' },
  { id: 'scan', label: 'Scan this PC', icon: 'memory' },
  { id: 'roles', label: 'Roles & model', icon: 'tune' },
  { id: 'plan', label: 'Plan', icon: 'checklist' },
  { id: 'install', label: 'Install', icon: 'download' },
  { id: 'verify', label: 'Verify', icon: 'verified' },
  { id: 'finish', label: 'Finish', icon: 'flag' },
];

export const GUIDE: Record<StepId, { mascot: MascotState; line: string }> = {
  welcome: {
    mascot: 'happy',
    line: "Hi, I'm Lefi! I'll walk you through installing Lefi Crop on this PC. Nothing changes until you press Install.",
  },
  activation: {
    mascot: 'wink',
    line: 'Lefi Crop is licensed per installation. Send Lefi the id below and paste the code you receive. Nothing is installed before that.',
  },
  scan: {
    mascot: 'curious',
    line: "First I'm reading what this PC has. Every number here is measured — if something can't be measured, I'll say unknown.",
  },
  roles: {
    mascot: 'thinking',
    line: 'Lefi Crop needs its local AI. Pick what this PC should run; I explain why each model fits or not.',
  },
  plan: {
    mascot: 'calm',
    line: 'This is the exact plan the installer will follow. It was produced by a dry run — nothing has been changed yet.',
  },
  install: {
    mascot: 'working',
    line: 'Installing now. Progress counts real steps and real downloaded bytes. Please keep this window open.',
  },
  verify: {
    mascot: 'thinking',
    line: 'Checking that everything really works: services answer, the model runs fully on the GPU, files are private.',
  },
  finish: {
    mascot: 'celebrating',
    line: 'All set! Here is where everything lives and what to do next.',
  },
};

export const FLEET_GUIDE: { mascot: MascotState; line: string } = {
  mascot: 'happy',
  line: 'Each PC that joins sends me its status every few seconds. If one goes quiet, you will see it here.',
};

export const ROLLBACK_GUIDE: { mascot: MascotState; line: string } = {
  mascot: 'caring',
  line: 'I am undoing only what this installation changed. Anything that was on this PC before stays as it was.',
};

export const ROLE_INFO: Record<
  'ai' | 'core' | 'admin' | 'desktop',
  { title: string; icon: string; body: string }
> = {
  ai: {
    title: 'AI node',
    icon: 'neurology',
    body: 'Ollama and one approved model. The model must run fully on this PC’s GPU.',
  },
  core: {
    title: 'Core node',
    icon: 'hub',
    body: 'The Lefi Brain, the MQTT broker for the ESP32 sensors, and the database.',
  },
  admin: {
    title: 'Lefi Gateway',
    icon: 'shield_lock',
    body: 'The HTTPS door to Lefi Brain (Caddy). Lefi Desktop connects through it.',
  },
  desktop: {
    title: 'Lefi Desktop',
    icon: 'dashboard',
    body: 'The dashboard app, on this Mac. Installed only if you select it. It shows live data once paired with Lefi Brain.',
  },
};

export const FIT_LABEL: Record<string, string> = {
  ok: 'Fits on the GPU',
  gpu: 'Fits on the GPU',
  no: 'Does not fit',
  unknown: 'Decided by the benchmark',
};
