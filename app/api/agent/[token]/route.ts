import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { enforceRateLimit } from '@/app/lib/rateLimit';
import {
  ATTACHED_WINDOW_MS, RUN_HISTORY_MS, applyAgentReport, buildAgentQueue, cleanRunId,
  isAgentBlocker, isAgentToken, readAgentEventKey, readAgentReport,
  type AgentEventKey, type AgentSnapshot,
} from '@/app/lib/agentSession';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'no-store' };

type SessionRow = {
  seq: number; updatedAt: Date; seenAt: Date | null; waitedAt: Date | null; focusAt: Date | null; focusRun: string | null;
};

function snapshot(row: SessionRow, queue: ReturnType<typeof buildAgentQueue>, now: number): AgentSnapshot {
  return {
    ...queue, seq: row.seq, updatedAt: row.updatedAt.getTime(),
    attached: !!row.seenAt && now - row.seenAt.getTime() < ATTACHED_WINDOW_MS,
    waitedAt: row.waitedAt?.getTime() ?? 0, focusAt: row.focusAt?.getTime() ?? 0, focusRun: row.focusRun,
  };
}

async function queueAction(req: Request, token: string, input: Record<string, unknown>) {
  const action = input.action;
  if (action !== 'ack' && action !== 'dismiss' && action !== 'clear' && action !== 'focus') {
    return NextResponse.json({ error: 'Unknown agent action' }, { status: 400 });
  }

  // Older games used a targetless focus request. It can be honored when there
  // is exactly one reachable choice. Explicit requests never switch targets.
  const legacyFocus = action === 'focus' && input.run === undefined && input.revision === undefined;
  let keys: AgentEventKey[] = [];
  if (action === 'clear') {
    if (!Array.isArray(input.items) || input.items.length > 100) {
      return NextResponse.json({ error: 'Send up to 100 items to clear' }, { status: 400 });
    }
    for (const item of input.items) {
      const key = readAgentEventKey(item);
      if (!key) return NextResponse.json({ error: 'Send a run and revision for each item' }, { status: 400 });
      keys.push(key);
    }
  } else if (!legacyFocus) {
    const key = readAgentEventKey(input);
    if (!key) return NextResponse.json({ error: 'Send a run and revision' }, { status: 400 });
    keys = [key];
  }

  const limited = await enforceRateLimit(req, { name: 'agent-focus', limit: 30, windowSec: 60 }, 'Too many requests. Slow down a little.');
  if (limited) return limited;

  const result = await prisma.$transaction(async (tx) => {
    // Serialize queue actions with reports so a prompt, revision check and
    // focus request cannot overwrite one another between reads and writes.
    const lock = await tx.agentSession.updateMany({ where: { token }, data: { seq: { increment: 0 } } });
    if (!lock.count) return null;
    const session = await tx.agentSession.findUniqueOrThrow({ where: { token } });
    const now = Date.now();
    const rows = await tx.agentRun.findMany({ where: { token } });
    const queue = buildAgentQueue(rows, now);
    const matches = (key: AgentEventKey) => keys.some((item) => item.run === key.run && item.revision === key.revision);

    if (action === 'focus') {
      const reachable = queue.runs.filter((run) => run.returnTarget !== 'unavailable');
      const legacyChoices = reachable.filter((run) => run.state !== 'working' && !run.dismissed);
      const target = legacyFocus ? (legacyChoices.length === 1 ? legacyChoices[0] : null) : reachable.find(matches);
      if (!target) return { status: 409, body: { error: 'This chat is no longer available to return to' } };
      // wait.sh uses this timestamp as its request identifier.
      const focusAt = new Date(Math.max(now, (session.focusAt?.getTime() ?? 0) + 1));
      const updated = await tx.agentSession.update({
        where: { token }, data: { focusAt, focusRun: target.run, seq: { increment: 1 } },
      });
      return { status: 200, body: snapshot(updated, queue, now) };
    }

    const targets = queue.runs.filter((run) => matches(run) && !run.dismissed &&
      (action !== 'ack' || !run.acknowledged) &&
      (isAgentBlocker(run) || (action !== 'clear' && run.reason === 'done')));
    if (targets.length === 0) return { status: 200, body: snapshot(session, queue, now) };

    const dismiss = new Set(targets.filter((target) => action !== 'ack' || target.reason === 'done').map((target) => target.run));
    const acknowledge = targets.filter((target) => !dismiss.has(target.run)).map((target) => target.run);
    if (acknowledge.length) {
      await tx.agentRun.updateMany({
        where: { token, run: { in: acknowledge } }, data: { acknowledged: true },
      });
    }
    if (dismiss.size) {
      await tx.agentRun.updateMany({
        where: { token, run: { in: [...dismiss] } }, data: { acknowledged: true, dismissed: true },
      });
    }
    const updated = await tx.agentSession.update({ where: { token }, data: { seq: { increment: 1 } } });
    const nextRows = await tx.agentRun.findMany({ where: { token } });
    return { status: 200, body: snapshot(updated, buildAgentQueue(nextRows, now), now) };
  });

  if (!result) return NextResponse.json({ error: 'Not paired' }, { status: 404 });
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}

// Hook reports carry the state, reason, agent type, opaque run/event IDs and
// timing. Everything used to navigate to the chat stays on the local machine.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isAgentToken(token)) return NextResponse.json({ error: 'Bad session token' }, { status: 400 });

  let body: unknown;
  try { body = JSON.parse((await req.text()).slice(0, 8192)); } catch { return NextResponse.json({ error: 'Send JSON' }, { status: 400 }); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Send a JSON object' }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (input.action !== undefined) return queueAction(req, token, input);

  const report = readAgentReport(input, Date.now());
  if (!report) return NextResponse.json({ error: 'Invalid agent report' }, { status: 400 });
  const limited = await enforceRateLimit(req, { name: 'agent-report', limit: 240, windowSec: 60 }, 'Too many agent updates. Slow down a little.');
  if (limited) return limited;

  const run = cleanRunId(input.session);
  const data = await prisma.$transaction(async (tx) => {
    // Touch the session row first to serialize reports and browser actions.
    const session = await tx.agentSession.upsert({
      where: { token },
      create: { token, state: 'idle' },
      update: { seq: { increment: 0 } },
    });
    const now = new Date();
    const previous = await tx.agentRun.findUnique({ where: { token_run: { token, run } } });
    const event = applyAgentReport(previous, report, now, session.seq + 1);
    if (!event) return snapshot(session, buildAgentQueue(await tx.agentRun.findMany({ where: { token } }), now.getTime()), now.getTime());

    await tx.agentRun.upsert({
      where: { token_run: { token, run } },
      create: { token, run, ...event },
      update: event,
    });
    await tx.agentRun.deleteMany({
      where: {
        token, updatedAt: { lt: new Date(now.getTime() - RUN_HISTORY_MS) },
        OR: [{ state: { not: 'waiting' } }, { reason: null }, { reason: { notIn: ['permission', 'question'] } }, { dismissed: true }],
      },
    });
    const queue = buildAgentQueue(await tx.agentRun.findMany({ where: { token } }), now.getTime());
    const row = await tx.agentSession.update({
      where: { token },
      data: {
        state: queue.state, reason: queue.reason, agent: queue.agent, working: queue.working, waiting: queue.waiting,
        ...(event.revision === session.seq + 1 && (isAgentBlocker(event) || event.reason === 'done') ? { waitedAt: now } : {}),
        seq: { increment: 1 }, updatedAt: now,
      },
    });
    return snapshot(row, queue, now.getTime());
  });
  return NextResponse.json(data, { headers: NO_STORE });
}

// The arcade tab long-polls: wait until a report or action changes the sequence
// or ~20 seconds pass. Rebuild on each returned poll to expire old runs even if
// another agent keeps sending reports.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isAgentToken(token)) return NextResponse.json({ error: 'Bad session token' }, { status: 400 });

  const url = new URL(req.url);
  const since = Number(url.searchParams.get('seq'));
  const peek = url.searchParams.get('peek') === '1';
  const deadline = Date.now() + (Number.isFinite(since) && url.searchParams.has('seq') ? 20_000 : 0);

  let row: SessionRow | null = null;
  let marked = false;
  for (;;) {
    row = await prisma.agentSession.findUnique({ where: { token } });
    if (row && !peek && !marked) {
      marked = true;
      // This is only a hint for the plugin's automatic window-opening logic.
      prisma.agentSession.update({ where: { token }, data: { seenAt: new Date() } }).catch(() => {});
    }
    if ((row && row.seq !== since) || Date.now() >= deadline || req.signal.aborted) break;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  if (!row) return NextResponse.json({
    state: 'unpaired', seq: 0, attached: false, working: 0, waiting: 0, waitedAt: 0, focusAt: 0, focusRun: null,
    foregroundRun: null, notice: null, runs: [],
  }, { headers: NO_STORE });
  const now = Date.now();
  const queue = buildAgentQueue(await prisma.agentRun.findMany({ where: { token } }), now);
  return NextResponse.json(snapshot(row, queue, now), { headers: NO_STORE });
}
