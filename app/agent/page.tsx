import type { Metadata } from 'next';
import AgentClient from './AgentClient';
import './agent.css';

export const metadata: Metadata = {
  title: 'Play while your agent works · I Need a Distraction',
  description: 'A plugin for Codex and Claude Code. Play a game while your coding agent works; it pauses the moment the agent finishes or needs you.',
  alternates: { canonical: '/agent' },
  openGraph: { title: 'Play while your agent works', description: 'A game that pauses the second your coding agent needs you. For Codex and Claude Code.', url: '/agent' },
};

export default function AgentPage() { return <AgentClient />; }
