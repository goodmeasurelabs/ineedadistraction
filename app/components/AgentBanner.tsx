'use client';

import { usePathname } from 'next/navigation';
import { useAgentSync } from '../games/engine/useAgentSync';
import { getGame } from '../games/registry';
import AgentQueue from './AgentQueue';
import { useDistractionSettings } from '../lib/useDistractionSettings';

export default function AgentBanner() {
  const pathname = usePathname();
  const slug = pathname?.match(/^\/games\/([^/]+)\/?$/)?.[1];
  if (pathname === '/arcade' || pathname === '/agent') return null;
  if (slug && getGame(slug)) return null;
  return <Banner />;
}

function Banner() {
  const agent = useAgentSync();
  const settings = useDistractionSettings();
  if (settings.loading || settings.error || settings.settings?.enabled === false) return null;
  return <AgentQueue agent={agent} />;
}
