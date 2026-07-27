'use client';

import type { ReactNode } from 'react';
import { EffectorNext } from '@effector/next';

/**
 * Client boundary over @effector/next.
 *
 * - In the root layout (no `values`): gives every client component access to
 *   the shared client scope.
 * - In a page (with `values` from that page's fork → allSettled → serialize):
 *   hydrates the client scope with the page's state — including on CLIENT-SIDE
 *   navigations, when Next re-runs the page's server component. This is what
 *   makes the model's page events (`pageStarted`, `userPageStarted`) fire per
 *   transition without any extra hooks.
 */
export function Providers({ values, children }: { values?: Record<string, unknown>; children: ReactNode }) {
  return <EffectorNext values={values}>{children}</EffectorNext>;
}
