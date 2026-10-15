import { ImageResponse } from 'next/og';
import { getOrbitTwist } from '@/app/lib/orbitPop';
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const raw = params.get('score') ?? '0';
  const score = /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
  const game = getOrbitTwist(params.get('twist'));
  return new ImageResponse(<div style={{ width: '100%', height: '100%', background: '#20382e', color: '#f4f3e9', padding: 64, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontFamily: 'sans-serif' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26 }}><span>I NEED A DISTRACTION</span><span>{game.title}</span></div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 25 }}><span style={{ fontSize: 170, fontWeight: 900, color: '#dafa78' }}>{score}</span><span style={{ fontSize: 44 }}>points. Your turn.</span></div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28 }}><span>20 seconds. One more try?</span><span>ineedadistraction.com ↗</span></div>
  </div>, { width: 1200, height: 630, headers: { 'Cache-Control': 'public, max-age=86400' } });
}
