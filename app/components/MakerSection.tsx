'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trackCTAClick } from '../lib/analytics';

const IDEAS = [
  { label: 'A cat with a jetpack', prompt: 'Make a one-button game where a cat with a jetpack dodges clouds and collects fish. Playable on a phone, short rounds, a score at the end and a big replay button.' },
  { label: 'Guess the sandwich weight', prompt: 'Make a 1-minute guessing game: show a silly sandwich, the player guesses its weight with a slider, five rounds, and an accuracy percentage at the end. Playable on a phone.' },
  { label: 'Just one more jump', prompt: 'Make a one-button jumping game with surprising platforms, quick restarts, and a score to beat. Rounds under a minute. Playable on a phone.' },
];

// The AI maker is the supply side of the break button: player-made games join
// the "Distract me" pool once they are published.
export default function MakerSection() {
  const router = useRouter();
  const [idea, setIdea] = useState('');

  function create(prompt = idea) {
    if (!prompt.trim()) return;
    trackCTAClick({ cta_text: 'Make my game', cta_location: 'idea_bar' });
    router.push(`/template/blank?idea=${encodeURIComponent(prompt.trim().slice(0, 500))}`);
  }

  return (
    <section className="magic-create" id="make-something" aria-labelledby="create-title">
      <div className="magic-create-heading"><span className="magic-asterisk" aria-hidden="true">✳</span><div><p className="magic-eyebrow">FEED THE BUTTON</p><h2 id="create-title">Make one and it joins the button.</h2></div><p>Describe a tiny game.<br />AI builds it. Publish it and it can come up when someone presses Distract me.</p></div>
      <form className="magic-idea-form" onSubmit={(event) => { event.preventDefault(); create(); }}>
        <label className="sr-only" htmlFor="game-idea">Your game idea</label>
        <input id="game-idea" value={idea} onChange={(event) => setIdea(event.target.value)} maxLength={500} placeholder="A tiny astronaut running a very chaotic coffee shop…" required />
        <button type="submit" className="magic-primary">Make my game <span aria-hidden="true">↗</span></button>
      </form>
      <div className="magic-ideas"><span>Or start from:</span>{IDEAS.map((item) => <button key={item.label} type="button" onClick={() => create(item.prompt)}>{item.label} <span aria-hidden="true">↗</span></button>)}</div>
      <p className="magic-create-note">AI builds take a moment. Sign in when you’re ready to publish. <a href="/make-a-game">How the game maker works</a></p>
    </section>
  );
}
