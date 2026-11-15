import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'AI Game Maker — Make a Mini-Game Without Coding',
  description: 'Describe a small game, play what AI builds, and remix it with your own ideas. Start creating for free in your browser. No coding or downloads needed.',
  alternates: { canonical: '/make-a-game' },
};
const ideas = [
  ['🐈', 'A cat with a jetpack', 'Make a one-button cat jetpack game. Tap to fly, avoid clouds, collect fish. Big mobile controls and quick replay.'],
  ['🌱', 'A garden that glows', 'Make a cozy garden where taps grow surprising glowing plants. No timer. Touch-friendly, with little discoveries.'],
  ['🪐', 'A tiny space adventure', 'Make a 20-second space dodge game with one-finger controls, a clear score, and a replay button.'],
];
export default function GameMaker() {
  return <div className="distraction-home"><main className="maker-landing">
    <a className="magic-text-link" href="/">← Back to the little arcade</a>
    <p className="magic-eyebrow">YOUR IMAGINATION HAS A PLAY BUTTON</p>
    <h1>That weird little idea?<br /><em>Make it a game.</em></h1>
    <p className="maker-lede">An AI game maker for curious people. Describe something small, get a playable mini-game, and keep making it more you.</p>
    <a className="magic-primary" href="/template/blank">Make my first game ↗</a>
    <p>No coding. No downloads. Start free; sign in when you’re ready to publish. Usage limits apply.</p>
    <h2>Steal a starting point.</h2>
    <div className="maker-ideas">{ideas.map(([emoji, title, idea]) => <a key={title} href={`/template/blank?idea=${encodeURIComponent(idea)}`}><span>{emoji}</span><h3>{title}</h3><p>Make this yours ↗</p></a>)}</div>
    <h2>From “what if” to “one more round.”</h2>
    <ol><li><strong>Describe a tiny idea.</strong> One action and a clear goal make a great first game. Try “tap to jump over sleepy clouds.”</li><li><strong>Play the first version.</strong> AI creation takes a moment. Test the controls, score, and restart before sharing.</li><li><strong>Add your personality.</strong> Ask for a new character, a strange power-up, or a different mood. Publish to get a link anyone can play.</li></ol>
    <h2>Can I make games on my phone?</h2><p>Yes. The editor works in your browser. Ask for touch controls, short rounds, and big buttons. Play on your phone before you publish.</p>
    <h2>Do I need an account?</h2><p>You can play games and start a first creation without signing up. Sign in to keep your games, publish them under your account, and continue creating.</p>
    <h2>Can I remix an existing game?</h2><p>Yes. Choose a game that allows remixes and give it a twist. Start with <a href="/template/orbit-pop">Orbit Pop</a>, <a href="/template/math-racer">Math Racer</a>, or explore <a href="/#community">the arcade</a>.</p>
    <h2>Will every AI game work perfectly?</h2><p>AI can make mistakes. Play-test your first version and describe what needs fixing in the editor. Start with a simple game, then add more.</p>
  </main></div>;
}
