import { allSettled, fork, serialize } from 'effector';
import { pageStarted } from '../src/users';
import { Providers } from './providers';
import { UsersScreen } from './users-screen';

// Force per-request rendering: the point of the demo is SSR, not a static page.
export const dynamic = 'force-dynamic';

/**
 * Server component: run the query in an isolated per-request scope, then hand
 * the serialized store values to the client. `usersQuery.$data` / `$status` /
 * `$params` travel via explicit sids — the first client paint shows the data,
 * status 'done', with no loading flash and no client refetch.
 *
 * The search is URL-driven: /?q=Marg renders server-side with that filter
 * already applied, and the input picks its initial value up from the restored
 * `$params` store — not from a prop.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;

  const scope = fork();
  await allSettled(pageStarted, { scope, params: { q } });
  const values = serialize(scope);

  return (
    <Providers values={values}>
      <UsersScreen />
    </Providers>
  );
}
