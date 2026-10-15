import type { MetadataRoute } from 'next';
import { prisma } from './lib/prisma';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = 'https://www.ineedadistraction.com';
  const games = await prisma.widget.findMany({ where: { published: true }, select: { id: true }, take: 45000, orderBy: { createdAt: 'desc' } });
  return [{ url: base + '/' }, { url: base + '/make-a-game' }, ...games.map(g => ({ url: `${base}/play/${encodeURIComponent(g.id)}` }))];
}
