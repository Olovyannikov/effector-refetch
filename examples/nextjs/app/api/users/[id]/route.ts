import { NextResponse } from 'next/server';
import { USERS } from '../../../../src/db';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await new Promise((r) => setTimeout(r, 400));
  const { id } = await ctx.params;
  const user = USERS.find((u) => u.id === Number(id));
  if (!user) return NextResponse.json({ message: 'not found' }, { status: 404 });
  return NextResponse.json(user);
}
