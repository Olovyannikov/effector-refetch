import { NextRequest, NextResponse } from 'next/server';
import { USERS } from '../../../src/db';

// Deliberately slow: makes the SSR difference visible — the server waits for the
// data before streaming HTML, so the client never sees a loading state on first paint.
export async function GET(request: NextRequest) {
  await new Promise((r) => setTimeout(r, 400));
  const q = request.nextUrl.searchParams.get('q')?.toLowerCase() ?? '';
  const users = (q ? USERS.filter((u) => u.name.toLowerCase().includes(q)) : USERS).map(
    ({ id, name, email }) => ({ id, name, email }),
  );
  return NextResponse.json(users);
}
