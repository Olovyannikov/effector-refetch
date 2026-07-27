'use client';

import Link from 'next/link';
import { useUnit } from 'effector-react';
import { $search, searchChanged, usersQuery } from '../src/users';

/**
 * Dumb view: every piece of state and every transition lives in the model
 * (src/users.ts) — the component binds units and renders. On first paint
 * everything comes from the server-serialized scope: $status is already
 * 'done', the list is pre-filtered, and the input shows the ?q= term from
 * the restored $search store. No useState, no useEffect.
 */
export function UsersScreen() {
  const { users, status, pending, q, onSearch } = useUnit({
    users: usersQuery.$data,
    status: usersQuery.$status,
    pending: usersQuery.$pending,
    q: $search,
    onSearch: searchChanged,
  });

  return (
    <main>
      <h1>effector-refetch × Next.js</h1>
      <p>
        Server-rendered through <code>fork → allSettled → serialize</code>; the first paint is already{' '}
        <code>status: {status}</code> — no skeleton, no refetch on mount. Try <a href="/?q=Marg">/?q=Marg</a>{' '}
        — the filter applies on the server.
      </p>

      <input
        value={q}
        placeholder="Search users… (debounced, TAKE_LATEST)"
        onChange={(e) => onSearch(e.target.value)}
        style={{ width: '100%', padding: '0.5rem', margin: '1rem 0' }}
      />

      <div style={{ minHeight: '1.5rem', opacity: 0.6 }}>{pending ? 'updating…' : `status: ${status}`}</div>

      <ul>
        {(users ?? []).map((u) => (
          <li key={u.id}>
            <Link href={`/users/${u.id}`}>
              <strong>{u.name}</strong>
            </Link>{' '}
            — {u.email}
          </li>
        ))}
      </ul>
      {users?.length === 0 && <p>Nobody matches “{q}”.</p>}
    </main>
  );
}
