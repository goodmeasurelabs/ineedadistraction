import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'I Need a Distraction — tiny games, happy accidents';

// Site-wide default OG image (homepage / dashboard / any page without its own).
export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #1c2a20 0%, #111715 50%, #243125 100%)',
          padding: '72px',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute', top: -140, right: -120, width: 420, height: 420, borderRadius: 9999,
            background: 'radial-gradient(circle, rgba(218,246,151,0.2) 0%, transparent 70%)', display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute', bottom: -120, left: -100, width: 360, height: 360, borderRadius: 9999,
            background: 'radial-gradient(circle, rgba(251,146,60,0.28) 0%, transparent 70%)', display: 'flex',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', fontSize: 26, fontWeight: 600, color: '#dcf998', zIndex: 10 }}>
          ✳ i need a distraction.
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', zIndex: 10 }}>
          <div
            style={{
              fontSize: 92, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.03em',
              lineHeight: 1.02, display: 'flex', flexWrap: 'wrap', maxWidth: 1040,
            }}
          >
            Less scrolling. More oh, wow.
          </div>
          <div style={{ marginTop: 26, fontSize: 38, color: '#c9d5bd', fontWeight: 500, display: 'flex', maxWidth: 960 }}>
            Tiny games. Happy accidents. Play instantly, then make it your own.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: '#dcf998', color: '#17221b',
              padding: '14px 26px', borderRadius: 999, fontSize: 27, fontWeight: 700,
              boxShadow: '0 10px 30px -10px rgba(218,246,151,0.15)',
            }}
          >
            Play a little ↗
          </div>
          <div style={{ display: 'flex', fontSize: 24, color: '#9ca3af' }}>ineedadistraction.com</div>
        </div>
      </div>
    ),
    size,
  );
}
