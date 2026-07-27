'use client';

import { useState } from 'react';
import { useUnit } from 'effector-react';
import { usersQuery } from '../src/users';

/**
 * Client component. On first paint everything below comes from the
 * server-serialized scope — $status is already 'done', the list is full.
 * Typing re-runs the query client-side: debounce 200ms + TAKE_LATEST abort.
 */
export function UsersScreen() {
  const { users, status, pending, start } = useUnit({
    users: usersQuery.$data,
    status: usersQuery.$status,
    pending: usersQuery.$pending,
    start: usersQuery.start,
  });
  const [q, setQ] = useState('');

  return (
    <main>
      <h1>effector-refetch × Next.js</h1>
      <p>
        Server-rendered through <code>fork → allSettled → serialize</code>; the first paint is already{' '}
        <code>status: {status}</code> — no skeleton, no refetch on mount.
      </p>

      <input
        value={q}
        placeholder="Search users… (debounced, TAKE_LATEST)"
        onChange={(e) => {
          setQ(e.target.value);
          start({ q: e.target.value });
        }}
        style={{ width: '100%', padding: '0.5rem', margin: '1rem 0' }}
      />

      <div style={{ minHeight: '1.5rem', opacity: 0.6 }}>{pending ? 'updating…' : `status: ${status}`}</div>

      <ul>
        {(users ?? []).map((u) => (
          <li key={u.id}>
            <strong>{u.name}</strong> — {u.email}
          </li>
        ))}
      </ul>
      {users?.length === 0 && <p>Nobody matches “{q}”.</p>}
    </main>
  );
}
