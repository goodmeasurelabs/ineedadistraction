'use client';

import Link from 'next/link';
import { trackCTAClick } from '../lib/analytics';
import './family-guy-promo.css';

export default function FamilyGuyPromo({ clipCount, location }: { clipCount: number; location: 'home_hero' | 'agent_hero' }) {
  return (
    <Link
      href="/agent?mode=family-guy"
      className="family-guy-promo"
      prefetch={false}
      onClick={() => trackCTAClick({ cta_text: 'Set up Family Guy clips', cta_location: location })}
    >
      {/* Official still from the Family Guy channel, video TWjJxXgWxUs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/featured/family-guy.jpg" alt="" width="1280" height="720" />
      <span className="family-guy-promo-copy">
        <strong>Family Guy clips</strong>
        <span>Shuffle {clipCount} scenes while your agent works.</span>
        <b>Set up popup <span aria-hidden="true">→</span></b>
      </span>
    </Link>
  );
}
