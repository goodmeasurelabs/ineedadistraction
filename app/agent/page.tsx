import type { Metadata } from 'next';
import AgentClient from './AgentClient';
import './agent.css';

export const metadata: Metadata = {
  title: 'Your agent works. You play. · I Need a Distraction',
  description: 'Choose your game mix and pair Codex or Claude Code with one setup prompt. Play while your agent works, pause when it needs you, and switch distractions off any time.',
  alternates: { canonical: '/agent' },
  openGraph: { title: 'Your agent works. You play.', description: 'Your favorite games, a coding agent, and an always-available off switch.', url: '/agent' },
};

export default function AgentPage() {
  return <AgentClient />;
}
