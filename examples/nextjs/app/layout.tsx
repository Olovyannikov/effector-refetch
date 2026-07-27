import type { ReactNode } from 'react';

export const metadata = {
  title: 'effector-refetch × Next.js',
  description: 'Zero-flash SSR with @effector/next and effector-refetch',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem auto', maxWidth: 640 }}>
        {children}
      </body>
    </html>
  );
}
