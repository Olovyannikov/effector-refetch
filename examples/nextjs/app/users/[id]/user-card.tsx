'use client';

import Link from 'next/link';
import { useUnit } from 'effector-react';
import { userQuery } from '../../../src/users';

/** Dumb view over the SSR-restored $state union of the detail query. */
export function UserCard() {
  const state = useUnit(userQuery.$state);

  if (state.status === 'fail') {
    return (
      <main>
        <p>Failed to load the user.</p>
        <Link href="/">← Back to the list</Link>
      </main>
    );
  }
  if (state.status !== 'done') {
    // only reachable on client-side transitions — SSR arrives as 'done'
    return <main>Loading…</main>;
  }

  const user = state.data;
  return (
    <main>
      <Link href="/">← Back to the list</Link>
      <h1>{user.name}</h1>
      <p style={{ opacity: 0.7 }}>
        {user.role} · {user.location} · <a href={`mailto:${user.email}`}>{user.email}</a>
      </p>
      <p>{user.bio}</p>
    </main>
  );
}
