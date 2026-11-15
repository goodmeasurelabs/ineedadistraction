import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { enforceRateLimit } from '@/app/lib/rateLimit';
import {
  ATTACHED_WINDOW_MS, cleanAgentLabel, cleanReason, isAgentState, isAgentToken,
  type AgentSnapshot, type AgentState,
} from '@/app/lib/agentSession';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Row = { state: string; reason: string | null; agent: string | null; seq: number; updatedAt: Date; seenAt: Date | null };

function snapshot(row: Row): AgentSnapshot {
  return {
    state: row.state as AgentState,
    reason: cleanReason(row.reason),
    agent: row.agent,
    seq: row.seq,
    updatedAt: row.updatedAt.getTime(),
    attached: !!row.seenAt && Date.now() - row.seenAt.getTime() < ATTACHED_WINDOW_MS,
  };
}

const NO_STORE = { 'Cache-Control': 'no-store' };

// The plugin's hooks report the agent's state here. The body carries only the
// state, a coarse reason, and which agent it is: never prompts, paths or code.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isAgentToken(token)) return NextResponse.json({ error: 'Bad session token' }, { status: 400 });

  let body: unknown;
  try { body = JSON.parse((await req.text()).slice(0, 2000)); } catch { return NextResponse.json({ error: 'Send JSON' }, { status: 400 }); }
  const input = (body ?? {}) as Record<string, unknown>;
  if (!isAgentState(input.state)) return NextResponse.json({ error: 'state must be working, waiting or idle' }, { status: 400 });

  const limited = await enforceRateLimit(req, { name: 'agent-report', limit: 240, windowSec: 60 }, 'Too many agent updates. Slow down a little.');
  if (limited) return limited;

  const reason = cleanReason(input.reason);
  const agent = cleanAgentLabel(input.agent);
  const row = await prisma.agentSession.upsert({
    where: { token },
    create: { token, state: input.state, reason, agent, seq: 1, updatedAt: new Date() },
    update: { state: input.state, reason, ...(agent ? { agent } : {}), seq: { increment: 1 }, updatedAt: new Date() },
  });
  return NextResponse.json(snapshot(row), { headers: NO_STORE });
}

// The arcade tab long-polls: pass the last seq it saw and the request returns
// as soon as the agent's state changes (or after ~20s with the same state).
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isAgentToken(token)) return NextResponse.json({ error: 'Bad session token' }, { status: 400 });

  const url = new URL(req.url);
  const since = Number(url.searchParams.get('seq'));
  const peek = url.searchParams.get('peek') === '1'; // plugin status checks do not count as a tab
  const deadline = Date.now() + (Number.isFinite(since) && url.searchParams.has('seq') ? 20_000 : 0);

  let row: Row | null = null;
  let marked = false;
  for (;;) {
    row = await prisma.agentSession.findUnique({ where: { token } });
    if (row && !peek && !marked) {
      marked = true;
      // Best effort: lets the plugin know a game tab is already open.
      prisma.agentSession.update({ where: { token }, data: { seenAt: new Date() } }).catch(() => {});
    }
    const changed = row ? row.seq !== since : false;
    if (changed || Date.now() >= deadline || req.signal.aborted) break;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  if (!row) return NextResponse.json({ state: 'unpaired', seq: 0, attached: false }, { headers: NO_STORE });
  return NextResponse.json(snapshot(row), { headers: NO_STORE });
}
