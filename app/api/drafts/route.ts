import { validateGame } from '@/app/lib/publishValidation';
import { enforceRateLimit } from '@/app/lib/rateLimit';
import { NextResponse } from 'next/server';
import { getDraftsByOwner, createDraft } from '@/app/lib/drafts';
import { resolveOwner } from '@/app/lib/owner';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const owner = await resolveOwner(req);
  if (!owner) return NextResponse.json([]);
  const all = await getDraftsByOwner(owner);
  const templateId = new URL(req.url).searchParams.get('templateId');
  return NextResponse.json(templateId ? all.filter((d) => d.templateId === templateId) : all);
}

export async function POST(req: Request) {
  const owner = await resolveOwner(req);
  if (!owner) return NextResponse.json({ error: 'No owner identity — sign in or send X-Client-Id' }, { status: 401 });

  const limited = await enforceRateLimit(req, { name: 'draft', limit: 40, windowSec: 3600 });
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid draft' }, { status: 400 });
  const invalid = validateGame({ ...body, title: body.title || 'Untitled Draft' });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const { title, description, emoji, html, templateId } = body;
  if (!html || typeof templateId !== 'string' || !templateId || templateId.length > 100) {
    return NextResponse.json({ error: 'html and templateId required' }, { status: 400 });
  }

  const draft = await createDraft(
    {
      title: title || 'Untitled Draft',
      description: description || '',
      emoji: emoji || '🎮',
      html,
      templateId,
    },
    owner
  );
  return NextResponse.json(draft, { status: 201 });
}
