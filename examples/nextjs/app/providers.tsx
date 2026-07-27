'use client';

import type { ReactNode } from 'react';
import { EffectorNext } from '@effector/next';

/** Client boundary: hydrates the effector scope from the server-serialized values. */
export function Providers({ values, children }: { values: Record<string, unknown>; children: ReactNode }) {
  return <EffectorNext values={values}>{children}</EffectorNext>;
}
