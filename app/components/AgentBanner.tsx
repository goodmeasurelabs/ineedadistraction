'use client';

import { usePathname } from 'next/navigation';
import { useAgentSync } from '../games/engine/useAgentSync';
import { getGame } from '../games/registry';
import AgentQueue from './AgentQueue';

export default function AgentBanner() {
  const pathname = usePathname();
  const slug = pathname?.match(/^\/games\/([^/]+)\/?$/)?.[1];
  if (slug && getGame(slug)) return null;
  return <Banner />;
}

function Banner() {
  const agent = useAgentSync();
  return <AgentQueue agent={agent} />;
}
