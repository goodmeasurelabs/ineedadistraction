import type { Metadata } from 'next';
import BreakLanding from '../components/BreakLanding';
import { AT_WORK } from '../lib/landings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Games to Play at Work · Silent 2-Minute Breaks',
  description: 'Silent games to play at work in under two minutes, with a break timer and an Esc key that hides the game behind a plain document. No sign-up.',
  alternates: { canonical: '/games-to-play-at-work' },
  openGraph: { title: 'Games to Play at Work · Silent 2-Minute Breaks', description: 'Silent games to play at work in under two minutes, with a break timer and an Esc key that hides the game behind a plain document. No sign-up.', url: '/games-to-play-at-work', siteName: 'I Need a Distraction', type: 'website' },
};

export default function Page() {
  return <BreakLanding config={AT_WORK} />;
}
