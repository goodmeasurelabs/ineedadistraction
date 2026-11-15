import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GAMES, getGame } from '../registry';
import GameClient from './GameClient';

export function generateStaticParams() { return GAMES.map((game) => ({ slug: game.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const game = getGame((await params).slug);
  if (!game) return {};
  const title = `${game.title}: ${game.tagline}`;
  return {
    title: `${game.title} · I Need a Distraction`,
    description: game.description,
    alternates: { canonical: `/games/${game.slug}` },
    openGraph: { title, description: game.description, url: `/games/${game.slug}` },
    twitter: { card: 'summary_large_image', title, description: game.description },
  };
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const game = getGame((await params).slug);
  if (!game) notFound();
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'VideoGame', name: game.title, description: game.description,
    url: `https://www.ineedadistraction.com/games/${game.slug}`, genre: game.tags, gamePlatform: 'Web browser',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <GameClient slug={game.slug} />
    </>
  );
}
