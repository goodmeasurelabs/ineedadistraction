import type { Metadata } from 'next';
import BreakLanding from '../components/BreakLanding';
import { FIVE_MINUTE } from '../lib/landings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '5-Minute Games · Quick Free Games, No Sign-Up',
  description: 'Quick free games for when you have five minutes. Each takes under two minutes and ends on one score you can share. No sign-up, no download.',
  alternates: { canonical: '/5-minute-games' },
  openGraph: { title: '5-Minute Games · Quick Free Games, No Sign-Up', description: 'Quick free games for when you have five minutes. Each takes under two minutes and ends on one score you can share. No sign-up, no download.', url: '/5-minute-games', siteName: 'I Need a Distraction', type: 'website' },
};

export default function Page() {
  return <BreakLanding config={FIVE_MINUTE} />;
}
