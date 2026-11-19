import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { enforceRateLimit } from '@/app/lib/rateLimit';
import { isAgentToken } from '@/app/lib/agentSession';
import {
  agentPreferencesSnapshot, readAgentPreferencesAction, sameDistractionPreferences,
} from '@/app/lib/agentPreferences';
import { parseDistractionPreferences } from '@/app/lib/distractionPreferences';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };
type Context = { params: Promise<{ token: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

// The existing random pairing token is a capability shared by the browser and
// local plugin. This endpoint accepts only settings, never executable commands.
export async function GET(req: Request, { params }: Context) {
  const { token } = await params;
  if (!isAgentToken(token)) return json({ error: 'Bad session token' }, 400);
  const limited = await enforceRateLimit(req, { name: 'agent-settings-read', limit: 600, windowSec: 60 }, 'Too many settings requests. Try again shortly.');
  if (limited) { limited.headers.set('Cache-Control', 'no-store'); return limited; }
  const row = await prisma.agentPreferences.findUnique({ where: { token } });
  return json(agentPreferencesSnapshot(row));
}

export async function POST(req: Request, { params }: Context) {
  const { token } = await params;
  if (!isAgentToken(token)) return json({ error: 'Bad session token' }, 400);
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'Send JSON' }, 415);
  if (Number(req.headers.get('content-length')) > 8192) return json({ error: 'Settings request is too large' }, 413);
  let input: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 8192) return json({ error: 'Settings request is too large' }, 413);
    input = JSON.parse(raw);
  } catch { return json({ error: 'Send JSON' }, 400); }
  const action = readAgentPreferencesAction(input);
  if (!action) return json({ error: 'Invalid distraction settings request' }, 400);
  const limited = await enforceRateLimit(req, {
    name: action.action === 'update' ? 'agent-settings-write' : 'agent-settings-plugin',
    limit: action.action === 'update' ? 60 : 120, windowSec: 60,
  }, 'Too many settings changes. Try again shortly.');
  if (limited) { limited.headers.set('Cache-Control', 'no-store'); return limited; }

  const result = await prisma.$transaction(async (tx) => {
    if (action.action === 'initialize') {
      // Creation reports the local settings already on disk. Reinitialization
      // only refreshes liveness; it cannot clobber a browser change or Off.
      const row = await tx.agentPreferences.upsert({
        where: { token },
        create: { token, settings: action.settings, revision: 1, appliedRevision: 1,
          pluginSeenAt: new Date(), pluginVersion: action.pluginVersion },
        update: { pluginSeenAt: new Date(), pluginVersion: action.pluginVersion },
      });
      return { status: 200, body: agentPreferencesSnapshot(row) };
    }

    // Serialize edits and acknowledgements on this pairing. The revision check
    // and resulting write must be one transaction, including no-op edits.
    const lock = await tx.agentPreferences.updateMany({ where: { token }, data: { revision: { increment: 0 } } });
    if (!lock.count) return { status: 409, body: { ...agentPreferencesSnapshot(null), error: 'Open your distraction through the updated plugin first.' } };
    const previous = await tx.agentPreferences.findUniqueOrThrow({ where: { token } });
    const conflict = (error: string) => ({ status: 409, body: { ...agentPreferencesSnapshot(previous), error } });

    if (action.action === 'ack') {
      if (action.revision !== previous.revision) return conflict('Settings changed before the plugin acknowledged them. Fetch the latest settings.');
      const row = await tx.agentPreferences.update({ where: { token }, data: {
        appliedRevision: action.revision, pluginSeenAt: new Date(), pluginVersion: action.pluginVersion,
      } });
      return { status: 200, body: agentPreferencesSnapshot(row) };
    }

    const previousSettings = parseDistractionPreferences(previous.settings);
    const sameSettings = previousSettings !== null && sameDistractionPreferences(previousSettings, action.settings);
    if (previous.lastMutationId === action.mutationId) {
      // A network retry never increments the revision. Reusing an ID for a
      // different payload is a conflict, not a second settings mutation.
      return sameSettings
        ? { status: 200, body: agentPreferencesSnapshot(previous) }
        : conflict('This settings request ID was already used.');
    }
    if (action.expectedRevision !== previous.revision) return conflict('Your settings changed elsewhere. Refresh and try again.');
    const row = await tx.agentPreferences.update({ where: { token }, data: {
      settings: action.settings, lastMutationId: action.mutationId,
      ...(sameSettings ? {} : { revision: { increment: 1 } }),
    } });
    return { status: 200, body: agentPreferencesSnapshot(row) };
  });
  return json(result.body, result.status);
}
