import { ImageResponse } from 'next/og';

// 1200x630 share card: game name, context line (date or round length), score.
export function scoreCard({ eyebrow, title, score, caption, accent }: { eyebrow: string; title: string; score: string | null; caption: string; accent: string }) {
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', background: '#17201c', color: '#f4f3e9', padding: 64, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26, color: '#c9d5bd' }}><span>✳ I NEED A DISTRACTION</span><span>{eyebrow}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 60, fontWeight: 800, letterSpacing: '-0.02em', display: 'flex' }}>{title}</div>
        {score
          ? <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, marginTop: 10 }}><span style={{ fontSize: 170, fontWeight: 900, color: accent }}>{score}</span><span style={{ fontSize: 44 }}>Your turn.</span></div>
          : <div style={{ display: 'flex', fontSize: 52, marginTop: 24, color: accent }}>A tiny game, about 2 minutes.</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28 }}><span>{caption}</span><span>ineedadistraction.com ↗</span></div>
    </div>,
    { width: 1200, height: 630, headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
