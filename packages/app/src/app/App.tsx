import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { Platform } from '@lefi/platform';
import { PlatformProvider } from '../platform/PlatformContext';
import { createQueryClient } from '../shared/lib/queryClient';
import { createAppRouter } from './router';

/** Root component. The host (apps/desktop) chooses and passes the platform. */
export function App({ platform }: { platform: Platform }) {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter(queryClient));
  return (
    <PlatformProvider platform={platform}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </PlatformProvider>
  );
}
