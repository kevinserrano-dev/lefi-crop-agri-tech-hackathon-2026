import type { QueryClient } from '@tanstack/react-query';
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { LoginPage, RequirePermission } from '../features/session';
import { AppShell } from '../features/shell';
import { NotServedYet } from '../features/shell/NotServedYet';
import { EmptyState } from '../shared/ui';
import { screens } from './screens';

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => <EmptyState mascot="curious" title="Page not found" />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: () => <AppShell screens={screens} />,
});

const screenRoutes = screens.map((s) =>
  createRoute({
    getParentRoute: () => appRoute,
    path: s.path,
    component: () => (
      <RequirePermission permission={s.permission}>
        <NotServedYet screen={s}>
          <s.component />
        </NotServedYet>
      </RequirePermission>
    ),
  }),
);

const routeTree = rootRoute.addChildren([loginRoute, appRoute.addChildren(screenRoutes)]);

/**
 * Hash history: works the same under Tauri's custom protocol, a file server or any future
 * shell, with no server-side rewrites.
 */
export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, history: createHashHistory(), context: { queryClient } });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
