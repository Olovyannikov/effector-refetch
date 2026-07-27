import { allSettled, fork, serialize } from 'effector';
import { userPageStarted } from '../../../src/users';
import { Providers } from '../../providers';
import { UserCard } from './user-card';

export const dynamic = 'force-dynamic';

/**
 * Detail page — same recipe as the list: one model entry point per route
 * (`userPageStarted`), fork per request, serialize, hand off to the client.
 * The bio arrives in the HTML; the client makes no request on load.
 */
export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const scope = fork();
  await allSettled(userPageStarted, { scope, params: { id: Number(id) } });
  const values = serialize(scope);

  return (
    <Providers values={values}>
      <UserCard />
    </Providers>
  );
}
