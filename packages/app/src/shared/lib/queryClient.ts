import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '@lefi/platform';
import { queryKeys } from '@lefi/api';

/**
 * Query defaults: never retry a 4xx (the Brain gave an answer), and on any 401 drop the
 * cached session so the shell returns to the sign-in screen.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) => {
        if (
          err instanceof ApiError &&
          err.isUnauthorized &&
          query.queryKey[0] !== queryKeys.session[0]
        ) {
          void client.invalidateQueries({ queryKey: queryKeys.session });
        }
      },
    }),
    defaultOptions: {
      queries: {
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
        refetchOnWindowFocus: false,
        staleTime: 5_000,
      },
    },
  });
  return client;
}
