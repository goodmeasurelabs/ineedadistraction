import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { enforceRateLimit } from '@/app/lib/rateLimit';
import {
  ATTACHED_WINDOW_MS, RUN_STALE_MS, cleanAgentLabel, cleanReason, cleanRunId, isAgentState, isAgentToken, rollUp,
  type AgentSnapshot, type AgentState,
} from '@/app/lib/agentSession';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Row = { state: string; reason: string | null; agent: string | null; seq: number; updatedAt: Date; seenAt: Date | null; working: number; waiting: number; waitedAt: Date | null; focusAt: Date | null; focusRun: string | null };

function snapshot(row: Row): AgentSnapshot {
  // Nothing has reported for a long time: the agents are gone, whatever the
  // last word was (a crash or a closed laptop never says goodbye).
  if (row.state !== 'idle' && Date.now() - row.updatedAt.getTime() > RUN_STALE_MS) {
    row = { ...row, state: 'idle', reason: 'end', working: 0, waiting: 0 };
  }
  return {
    state: row.state as AgentState,
    reason: cleanReason(row.reason),
    agent: row.agent,
    seq: row.seq,
    updatedAt: row.updatedAt.getTime(),
    attached: !!row.seenAt && Date.now() - row.seenAt.getTime() < ATTACHED_WINDOW_MS,
    working: row.working,
    waiting: row.waiting,
    waitedAt: row.waitedAt?.getTime() ?? 0,
    focusAt: row.focusAt?.getTime() ?? 0,
    focusRun: row.focusRun,
  };
}

const NO_STORE = { 'Cache-Control': 'no-store' };

// The plugin's hooks report the agent's state here. The body carries only the
// state, a coarse reason, and which agent it is: never prompts, paths or code.
// The game page posts here too, with { action: 'focus' } (see below).
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isAgentToken(token)) return NextResponse.json({ error: 'Bad session token' }, { status: 400 });

  let body: unknown;
  try { body = JSON.parse((await req.text()).slice(0, 2000)); } catch { return NextResponse.json({ error: 'Send JSON' }, { status: 400 }); }
  const input = (body ?? {}) as Record<string, unknown>;

  // The game's "Back to your agent" button. The plugin on the user's machine is
  // listening while its agent waits, and brings that terminal to the front.
  if (input.action === 'focus') {
    const limited = await enforceRateLimit(req, { name: 'agent-focus', limit: 30, windowSec: 60 }, 'Too many requests. Slow down a little.');
    if (limited) return limited;
    const row = await prisma.$transaction(async (tx) => {
      const session = await tx.agentSession.findUnique({ where: { token } });
      if (!session || snapshot(session).state !== 'waiting') return session;
      // Several agents may be waiting: go to the one that stopped most recently.
      const ready = await tx.agentRun.findFirst({
        where: { token, state: 'waiting', updatedAt: { gte: new Date(Date.now() - RUN_STALE_MS) } },
        orderBy: { updatedAt: 'desc' },
      });
      if (!ready) return session;
      return tx.agentSession.update({ where: { token }, data: { focusAt: new Date(), focusRun: ready.run, seq: { increment: 1 } } });
    });
    if (!row) return NextResponse.json({ error: 'Not paired' }, { status: 404 });
    return NextResponse.json(snapshot(row), { headers: NO_STORE });
  }

  if (!isAgentState(input.state)) return NextResponse.json({ error: 'state must be working, waiting or idle' }, { status: 400 });

  const limited = await enforceRateLimit(req, { name: 'agent-report', limit: 240, windowSec: 60 }, 'Too many agent updates. Slow down a little.');
  if (limited) return limited;

  const reason = cleanReason(input.reason);
  const agent = cleanAgentLabel(input.agent);
  const run = cleanRunId(input.session);
  const state = input.state;
  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    // Touch the roll-up row first: that takes its lock, so two agents reporting
    // at the same moment are applied one after the other.
    await tx.agentSession.upsert({
      where: { token },
      create: { token, state, reason, agent, seq: 0, updatedAt: now },
      update: { seq: { increment: 0 } },
    });
    if (state === 'idle') await tx.agentRun.deleteMany({ where: { token, run } });
    else await tx.agentRun.upsert({
      where: { token_run: { token, run } },
      create: { token, run, state, reason, agent, updatedAt: now },
      update: { state, reason, ...(agent ? { agent } : {}), updatedAt: now },
    });
    await tx.agentRun.deleteMany({ where: { token, updatedAt: { lt: new Date(now.getTime() - RUN_STALE_MS) } } });
    const all = rollUp(await tx.agentRun.findMany({ where: { token } }));
    return tx.agentSession.update({
      where: { token },
      data: {
        state: all.state, reason: all.state === 'idle' ? reason : all.reason, working: all.working, waiting: all.waiting,
        ...(state === 'waiting' ? { waitedAt: now } : {}),
        ...(all.agent ?? agent ? { agent: all.agent ?? agent } : {}), seq: { increment: 1 }, updatedAt: now,
      },
    });
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

  if (!row) return NextResponse.json({ state: 'unpaired', seq: 0, attached: false, working: 0, waiting: 0, waitedAt: 0, focusAt: 0, focusRun: null }, { headers: NO_STORE });
  return NextResponse.json(snapshot(row), { headers: NO_STORE });
}
