/**
 * The model — ALL logic lives in effector, the component only renders.
 *
 * `name: 'users'` gives the query stable sids (`er/users/$data`, …), so
 * `serialize(scope)` on the server and `<EffectorNext values>` on the client
 * transfer $data/$status/$params without the effector babel/SWC plugin.
 * Your OWN stores need sids too — here `$search` gets one explicitly (the
 * alternative is @effector/swc-plugin for the app code).
 */
import { createEvent, createEffect, createStore, sample } from 'effector';
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
  // typing supersedes the in-flight request (real abort)
  concurrency: 'TAKE_LATEST',
});

// pre-network debounce for the search box (operator form)
debounce(usersQuery, 200);

// ---- search flow ----------------------------------------------------------

/** Fired by the server component with the URL's ?q= — one entry point per request. */
export const pageStarted = createEvent<{ q: string }>();
/** Fired by the input on every keystroke. */
export const searchChanged = createEvent<string>();

/** The search term. Explicit sid → travels server -> client like the query stores. */
export const $search = createStore('', { sid: 'app/$search' })
  .on(pageStarted, (_state, { q }) => q)
  .on(searchChanged, (_state, q) => q);

// both entry points run the query; debounce above coalesces fast typing
sample({ clock: pageStarted, target: usersQuery.start });
sample({ clock: searchChanged, fn: (q) => ({ q }), target: usersQuery.start });

// keep the URL shareable — a side effect, so it lives in an effect (client-only)
const syncUrlFx = createEffect((q: string) => {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', q ? `?q=${encodeURIComponent(q)}` : window.location.pathname);
});
sample({ clock: searchChanged, target: syncUrlFx });

// ---- user detail page ------------------------------------------------------

export interface UserDetails extends User {
  role: string;
  location: string;
  bio: string;
}

export const userQuery = createJsonQuery<{ id: number }, UserDetails>({
  name: 'user',
  request: { url: ({ id }) => `${base}/api/users/${id}` },
});

/** Fired by the /users/[id] server component. */
export const userPageStarted = createEvent<{ id: number }>();
sample({ clock: userPageStarted, target: userQuery.start });
