import type { Metadata } from 'next';
import { getWidgets } from '../lib/store';
import { getOrbitTwist } from '../lib/orbitPop';
import DashboardClient from './DashboardClient';
export const dynamic = 'force-dynamic';
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ challenge?: string; twist?: string; tab?: string }> }): Promise<Metadata> {
  const params = await searchParams;
  if (params.tab === 'mine') return { robots: { index: false, follow: true }, alternates: { canonical: '/' } };
  if (params.challenge && /^\d{1,6}$/.test(params.challenge)) {
    const twist = getOrbitTwist(params.twist);
    const title = `${params.challenge} points in ${twist.title}. Your turn.`;
    const image = `/api/challenge-card?score=${params.challenge}&twist=${twist.id}`;
    return { title, alternates: { canonical: '/' }, openGraph: { title, description: 'A friend sent you a 20-second distraction. Play free.', images: [image] }, twitter: { card: 'summary_large_image', title, images: [image] } };
  }
  return { alternates: { canonical: '/' } };
}
export default async function DashboardPage() { return <DashboardClient initialWidgets={(await getWidgets()).map(({ html, ...game }) => ({ ...game, hasHtml: !!html }))} />; }
