import type { Metadata } from 'next';
import AgentClient from './AgentClient';
import './agent.css';

export const metadata: Metadata = {
  title: 'Play while your agent works · I Need a Distraction',
  description: 'A plugin for Codex and Claude Code. Play a game while your coding agent works; it pauses the moment the agent finishes or needs you.',
  alternates: { canonical: '/agent' },
  openGraph: { title: 'Play while your agent works', description: 'A game that pauses the second your coding agent needs you. For Codex and Claude Code.', url: '/agent' },
};

// The plugin opens this page in a chromeless window (#t=<token>&popup). Browsers
// ignore the window-size flags when already running, so the window arrives at
// their default size. Shape it to sit beside a terminal as soon as the HTML is
// parsed, before React loads, so the large window is on screen as briefly as
// possible.
const SHAPE_POPUP = `(function(){try{if(/&popup$/.test(location.hash)){var w=460,h=Math.min(800,screen.availHeight);resizeTo(w,h);moveTo(screen.availWidth-w-24,Math.max(0,(screen.availHeight-h)/2))}}catch(e){}})()`;

export default function AgentPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SHAPE_POPUP }} />
      <AgentClient />
    </>
  );
}
