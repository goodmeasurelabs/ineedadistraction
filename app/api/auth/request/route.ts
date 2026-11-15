import { NextResponse } from 'next/server';

// Clerk owns authentication; the old mail endpoint could create unowned games.
export async function POST() {
  return NextResponse.json({ error: 'Please sign in to publish your saved game.', signInUrl: '/sign-in' }, { status: 410 });
}
