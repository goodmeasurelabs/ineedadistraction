import type { MetadataRoute } from 'next';
import { prisma } from './lib/prisma';
import { STATIC_PATHS } from './lib/siteMap';
import { SITE_URL } from './lib/share';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let games: { id: string }[] = [];
  try {
    games = await prisma.widget.findMany({ where: { published: true }, select: { id: true }, take: 45000, orderBy: { createdAt: 'desc' } });
  } catch {
    // The static pages are still worth listing if the database is unreachable.
  }
  return [
    ...STATIC_PATHS.map((path) => ({ url: SITE_URL + path, changeFrequency: path === '/daily' ? 'daily' as const : undefined })),
    ...games.map((g) => ({ url: `${SITE_URL}/play/${encodeURIComponent(g.id)}` })),
  ];
}
