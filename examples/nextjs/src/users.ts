/**
 * The data layer — plain effector-refetch, declared once at module level.
 *
 * `name: 'users'` gives the query stable sids (`er/users/$data`, …), so
 * `serialize(scope)` on the server and `<EffectorNext values>` on the client
 * transfer $data/$status without the effector babel/SWC plugin.
 */
import { createJsonQuery, debounce } from 'effector-refetch';

export interface User {
  id: number;
  name: string;
  email: string;
}

// Relative URLs only exist in the browser; on the server (RSC / route runtime)
// we hit our own origin.
const base = typeof window === 'undefined' ? `http://localhost:${process.env.PORT ?? 3000}` : '';

export const usersQuery = createJsonQuery<{ q: string }, User[]>({
  name: 'users',
  request: {
    url: `${base}/api/users`,
    query: ({ q }) => (q ? { q } : {}),
  },
  // typing in the search box supersedes the in-flight request (real abort)
  concurrency: 'TAKE_LATEST',
});

// pre-network debounce for the search box (operator form)
debounce(usersQuery, 200);
