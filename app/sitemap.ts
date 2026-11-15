import type { MetadataRoute } from 'next';
import { prisma } from './lib/prisma';
import { GAMES } from './games/registry';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = 'https://www.ineedadistraction.com';
  const games = await prisma.widget.findMany({ where: { published: true }, select: { id: true }, take: 45000, orderBy: { createdAt: 'desc' } });
  return [{ url: base + '/' }, { url: base + '/make-a-game' }, { url: base + '/agent' }, ...GAMES.map(g => ({ url: `${base}/games/${g.slug}` })), ...games.map(g => ({ url: `${base}/play/${encodeURIComponent(g.id)}` }))];
}
