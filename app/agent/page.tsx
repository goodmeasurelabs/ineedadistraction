import type { Metadata } from 'next';
import AgentClient from './AgentClient';
import { FAMILY_GUY_CLIPS } from '../arcade/clips/catalog';
import './agent.css';

type PageProps = { searchParams: Promise<{ mode?: string | string[] }> };

const gameMetadata: Metadata = {
  title: 'Your agent works. You play. · I Need a Distraction',
  description: 'Choose your game mix and pair Codex or Claude Code with one setup prompt. Play while your agent works, pause when it needs you, and switch distractions off any time.',
  alternates: { canonical: '/agent' },
  openGraph: { title: 'Your agent works. You play.', description: 'Your favorite games, a coding agent, and an always-available off switch.', url: '/agent' },
};

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  if ((await searchParams).mode !== 'family-guy') return gameMetadata;
  const title = 'Family Guy clips for your agent popup';
  const description = 'Pair Codex or Claude Code to watch Family Guy clips while your agent works.';
  const link = '/agent?mode=family-guy';
  return { title, description, alternates: { canonical: link }, openGraph: { title, description, url: link } };
}

export default async function AgentPage({ searchParams }: PageProps) {
  const { mode } = await searchParams;
  return <AgentClient clipCount={mode === 'family-guy' ? FAMILY_GUY_CLIPS.length : undefined} />;
}
