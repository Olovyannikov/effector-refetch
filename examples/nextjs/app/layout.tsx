import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata = {
  title: 'effector-refetch × Next.js',
  description: 'Zero-flash SSR with @effector/next and effector-refetch',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem auto', maxWidth: 640 }}>
        {/* root provider: client-scope access for the whole tree; pages add
            their own <Providers values> with per-request serialized state */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
