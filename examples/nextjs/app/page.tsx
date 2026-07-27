import { allSettled, fork, serialize } from 'effector';
import { usersQuery } from '../src/users';
import { Providers } from './providers';
import { UsersScreen } from './users-screen';

// Force per-request rendering: the point of the demo is SSR, not a static page.
export const dynamic = 'force-dynamic';

/**
 * Server component: run the query in an isolated per-request scope, then hand
 * the serialized store values to the client. `usersQuery.$data` / `$status`
 * travel via explicit sids — the first client paint shows the data, status
 * 'done', with no loading flash and no client refetch.
 */
export default async function Page() {
  const scope = fork();
  await allSettled(usersQuery.start, { scope, params: { q: '' } });
  const values = serialize(scope);

  return (
    <Providers values={values}>
      <UsersScreen />
    </Providers>
  );
}
