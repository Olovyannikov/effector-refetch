import { NextRequest, NextResponse } from 'next/server';

const USERS = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@calc.dev' },
  { id: 2, name: 'Grace Hopper', email: 'grace@navy.mil' },
  { id: 3, name: 'Margaret Hamilton', email: 'margaret@apollo.nasa' },
  { id: 4, name: 'Katherine Johnson', email: 'katherine@nasa.gov' },
  { id: 5, name: 'Barbara Liskov', email: 'barbara@mit.edu' },
];

// Deliberately slow: makes the SSR difference visible — the server waits for the
// data before streaming HTML, so the client never sees a loading state on first paint.
export async function GET(request: NextRequest) {
  await new Promise((r) => setTimeout(r, 400));
  const q = request.nextUrl.searchParams.get('q')?.toLowerCase() ?? '';
  const users = q ? USERS.filter((u) => u.name.toLowerCase().includes(q)) : USERS;
  return NextResponse.json(users);
}
