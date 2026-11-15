import type { Metadata } from 'next';
import BreakLanding from '../components/BreakLanding';
import { BRAIN_BREAK } from '../lib/landings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Brain Break Games for the Whole Class · Free, No Logins',
  description: 'Silent 2-minute brain break games for the classroom projector. No student logins, no ads, no sound. Guess, count and call out together, then back to the lesson.',
  alternates: { canonical: '/brain-break-games' },
  openGraph: { title: 'Brain Break Games for the Whole Class · Free, No Logins', description: 'Silent 2-minute brain break games for the classroom projector. No student logins, no ads, no sound. Guess, count and call out together, then back to the lesson.', url: '/brain-break-games', siteName: 'I Need a Distraction', type: 'website' },
};

export default function Page() {
  return <BreakLanding config={BRAIN_BREAK} />;
}
