/**
 * Composition root — the ONLY place that picks a concrete platform.
 * Replacing Tauri means writing another host like this one; packages/app stays as is.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@lefi/app';
import { createTauriPlatform, isTauri } from '@lefi/platform/tauri';
import { createWebPlatform } from '@lefi/platform/web';

const platform = isTauri() ? createTauriPlatform() : createWebPlatform();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
);
