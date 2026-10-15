import { prisma } from '@/app/lib/prisma';
import { getTemplate } from '@/app/lib/templates';
import { validateGame } from '@/app/lib/publishValidation';
import { enforceRateLimit } from '@/app/lib/rateLimit';
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getWidgets, getWidgetsByUser, addWidget } from '@/app/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter');

    if (filter === 'mine') {
      const { userId } = await auth();
      if (!userId) return NextResponse.json([]);
      return NextResponse.json(await getWidgetsByUser(userId));
    }

    return NextResponse.json(await getWidgets());
  } catch (error) {
    console.error('[api/widgets] GET failed', error);
    return NextResponse.json({ error: 'Failed to load widgets' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Sign in to publish and own your game.' }, { status: 401 });
    const limited = await enforceRateLimit(req, { name: 'publish', limit: 10, windowSec: 3600 });
    if (limited) return limited;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid game' }, { status: 400 });
    const invalid = validateGame(body);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    const { title, description, emoji, html, author, tags, remixable, parentId } = body;

    let resolvedParentId: string | undefined;
    if (parentId) {
      if (typeof parentId !== 'string' || parentId.length > 100) return NextResponse.json({ error: 'Invalid parent game' }, { status: 400 });
      const parent = await prisma.widget.findUnique({ where: { id: parentId } });
      if (parent && parent.published && parent.remixable) resolvedParentId = parent.id;
      else if (parent || !getTemplate(parentId)) return NextResponse.json({ error: 'This game is unavailable for remixing.' }, { status: 400 });
    }

    const widget = await addWidget({
      title,
      description: description ?? '',
      emoji: emoji ?? '🎮',
      type: 'user-created',
      html,
      author: author ?? 'Anonymous',
      tags: tags ?? [],
      userId,
      remixable: remixable ?? true,
      parentId: resolvedParentId,
    });

    return NextResponse.json(widget, { status: 201 });
  } catch (error) {
    console.error('[api/widgets] POST failed', error);
    return NextResponse.json({ error: 'Failed to create widget' }, { status: 500 });
  }
}
