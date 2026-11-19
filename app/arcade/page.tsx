import type { Metadata } from 'next';
import ArcadeClient from './ArcadeClient';
import '../games/games.css';
import './arcade.css';

export const metadata: Metadata = {
  title: 'Your distraction · I Need a Distraction',
  description: 'Your game mix, beside your coding agent. Easy to pause. Easy to pick up again.',
  robots: { index: false, follow: false },
};

export default function ArcadePage() {
  return <ArcadeClient />;
}
