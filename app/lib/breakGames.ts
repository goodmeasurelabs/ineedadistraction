// Break-sized games: small, named, scored toys that each end on one number.
// Every game is a self-contained HTML document played in a sandboxed iframe.
// A numeric seed drives every random choice, so the same seed is the same
// challenge for everyone (that is how /daily works without server state) and
// a fresh seed is a fresh variant (that is how "Distract me" never runs dry).
// No network, no AI calls, no sound.
import { createOrbitPopHtml } from './orbitPop';

export type ScoreUnit = '%' | 'ms' | 's' | 'pts';

export type BreakGame = {
  slug: string;
  name: string;
  emoji: string;
  accent: string;
  tagline: string;
  description: string;
  howTo: string[];
  roundLabel: string;
  roundSeconds: number;
  unit: ScoreUnit;
  better: 'higher' | 'lower';
  scoreLabel: string;
  daily: boolean;
  classroom: string;
};

export const BREAK_GAMES: BreakGame[] = [
  {
    slug: 'stop-the-clock', name: 'Stop the Clock', emoji: '⏱️', accent: '#d8fa76',
    tagline: 'Stop the timer at an exact time. The numbers vanish after one second.',
    description: 'A stopwatch game for your inner clock. You get a target like 7.42 seconds, the timer disappears after the first second, and you stop it by feel. Three tries, scored on average accuracy.',
    howTo: ['Press start and count in your head.', 'The clock hides after one second.', 'Press stop when you think the target time has passed. Three tries.'],
    roundLabel: 'About 30 seconds', roundSeconds: 30, unit: '%', better: 'higher', scoreLabel: 'accuracy', daily: true,
    classroom: 'The whole class counts silently; one student presses stop.',
  },
  {
    slug: 'split-the-bar', name: 'Split the Bar', emoji: '📏', accent: '#ffb292',
    tagline: 'Cut a blank bar at 37%. No ruler, no tick marks, just your eye.',
    description: 'A proportion game. Each round asks you to cut an empty bar at a percentage, like 37% or 82%, with nothing to measure against. Five cuts, scored on how close you land.',
    howTo: ['Read the target percentage.', 'Tap the bar where you think it is (or use arrow keys, then Enter).', 'See the real spot. Five cuts in a round.'],
    roundLabel: 'About 40 seconds', roundSeconds: 40, unit: '%', better: 'higher', scoreLabel: 'accuracy', daily: true,
    classroom: 'Students call out "left" or "right" before the cut is made.',
  },
  {
    slug: 'dot-flash', name: 'Dot Flash', emoji: '🫧', accent: '#9fefd0',
    tagline: 'A cloud of dots flashes for under a second. How many were there?',
    description: 'An estimation game. Dots appear for less than a second, then vanish, and you guess the count. Five flashes that get busier, scored on how close your guesses are.',
    howTo: ['Watch the box. Dots flash for under a second.', 'Type how many you think there were.', 'See the real count. Five flashes in a round.'],
    roundLabel: 'About 45 seconds', roundSeconds: 45, unit: '%', better: 'higher', scoreLabel: 'accuracy', daily: true,
    classroom: 'Everyone writes a guess; the class average often beats any one person.',
  },
  {
    slug: 'color-recall', name: 'Color Recall', emoji: '🎨', accent: '#c7b8ff',
    tagline: 'See a color for three seconds. Rebuild it from memory.',
    description: 'A color memory game. A swatch shows for three seconds, then you rebuild it with hue, saturation and lightness sliders. Three colors, scored on how close you get.',
    howTo: ['Study the color for three seconds.', 'Rebuild it with the three sliders.', 'Lock it in and compare. Three colors in a round.'],
    roundLabel: 'About 1 minute', roundSeconds: 60, unit: '%', better: 'higher', scoreLabel: 'match', daily: true,
    classroom: 'The class votes on each slider before locking it in.',
  },
  {
    slug: 'keep-the-rhythm', name: 'Keep the Rhythm', emoji: '🥁', accent: '#ffd479',
    tagline: 'Tap along with a silent pulse. Then it disappears. Keep the beat.',
    description: 'A timing game with no sound at all. A pulse sets a tempo for four beats, then vanishes, and you keep tapping at the same speed. Scored on how steady your beat stays.',
    howTo: ['Press start and tap along with the flashing pulse.', 'After four beats it fades out.', 'Keep tapping at the same tempo until 16 taps.'],
    roundLabel: 'About 20 seconds', roundSeconds: 20, unit: '%', better: 'higher', scoreLabel: 'steadiness', daily: true,
    classroom: 'The whole class claps the beat while one student taps.',
  },
  {
    slug: 'number-hunt', name: 'Number Hunt', emoji: '🔢', accent: '#8fd3ff',
    tagline: 'Find 1 to 25 in a scrambled grid, in order, as fast as you can.',
    description: 'A focus game. Twenty-five numbers are scrambled in a grid and you tap them in order from 1 to 25. Scored on your time, so lower is better.',
    howTo: ['Find and tap 1.', 'Then 2, then 3, all the way to 25.', 'Your time is your score. Lower is better.'],
    roundLabel: 'About 40 seconds', roundSeconds: 40, unit: 's', better: 'lower', scoreLabel: 'time', daily: true,
    classroom: 'Students call out where the next number is.',
  },
  {
    slug: 'green-means-go', name: 'Green Means Go', emoji: '🟢', accent: '#7cf0a0',
    tagline: 'Wait for green. Tap. Five tries at your fastest reaction.',
    description: 'A reaction-time game. The panel turns green after a random wait and you tap as fast as you can. Tap too early and that try restarts. Scored on your average time in milliseconds.',
    howTo: ['Wait while the panel says "Wait for green".', 'Tap the moment it turns green.', 'Five tries. Your average is your score. Lower is better.'],
    roundLabel: 'About 30 seconds', roundSeconds: 30, unit: 'ms', better: 'lower', scoreLabel: 'reaction time', daily: false,
    classroom: 'Take turns at the keyboard and keep a class high score on the board.',
  },
  {
    slug: 'orbit-pop', name: 'Orbit Pop', emoji: '✦', accent: '#d8fa76',
    tagline: 'Catch glowing stars and dodge the decoys for 20 seconds.',
    description: 'A 20-second arcade game. Tap the stars, avoid the decoys and build a streak for bonus points. Scored in points.',
    howTo: ['Tap or click the stars.', 'Avoid the ⊗ decoys, which cost points.', 'Streaks earn bonus points. 20 seconds.'],
    roundLabel: '20 seconds', roundSeconds: 20, unit: 'pts', better: 'higher', scoreLabel: 'points', daily: false,
    classroom: 'Take turns and keep a class high score on the board.',
  },
];

export function getBreakGame(slug: string | null | undefined): BreakGame | undefined {
  return BREAK_GAMES.find((game) => game.slug === slug);
}

// ---- Seeded randomness (mirrored inside the game documents) ----

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

const between = (r: () => number, min: number, max: number) => Math.floor(min + r() * (max - min + 1));

export type GameConfig = Record<string, unknown>;

export function makeConfig(slug: string, seed: number): GameConfig {
  const r = mulberry32(seed);
  switch (slug) {
    case 'stop-the-clock':
      return { target: Math.round((4 + r() * 5.99) * 100) / 100, tries: 3 };
    case 'split-the-bar': {
      const targets: number[] = [];
      while (targets.length < 5) {
        const t = between(r, 6, 94);
        if ([25, 50, 75].includes(t) || targets.some((x) => Math.abs(x - t) < 6)) continue;
        targets.push(t);
      }
      return { targets };
    }
    case 'dot-flash':
      return { counts: [[8, 18], [14, 30], [20, 42], [28, 56], [36, 72]].map(([a, b]) => between(r, a, b)), seed: (seed ^ 0x9e3779b9) >>> 0 };
    case 'color-recall':
      return { colors: [0, 1, 2].map(() => ({ h: between(r, 0, 359), s: between(r, 45, 90), l: between(r, 35, 66) })) };
    case 'keep-the-rhythm':
      return { bpm: between(r, 36, 66) * 2, beats: 4, taps: 16 };
    case 'green-means-go':
      return { delays: [0, 1, 2, 3, 4].map(() => between(r, 1200, 4000)) };
    case 'number-hunt': {
      const order = Array.from({ length: 25 }, (_, i) => i + 1);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      return { order };
    }
    case 'orbit-pop':
      return { twist: r() < 0.5 ? 'classic' : 'chaos' };
    default:
      throw new Error(`Unknown break game: ${slug}`);
  }
}

const HUE_NAMES: [number, string][] = [
  [15, 'Red'], [40, 'Orange'], [55, 'Amber'], [75, 'Yellow'], [100, 'Lime'], [150, 'Green'], [170, 'Mint'],
  [190, 'Teal'], [215, 'Sky'], [245, 'Blue'], [275, 'Indigo'], [300, 'Violet'], [335, 'Pink'], [360, 'Red'],
];

export function hueName(h: number): string {
  return (HUE_NAMES.find(([max]) => h < max) ?? HUE_NAMES[0])[1];
}

// A short, literal name for one seeded variant, e.g. "Stop at 7.42 Seconds".
export function variantTitle(slug: string, config: GameConfig): string {
  switch (slug) {
    case 'stop-the-clock': return `Stop at ${(config.target as number).toFixed(2)} Seconds`;
    case 'color-recall': return `${hueName((config.colors as { h: number }[])[0].h)} Recall`;
    case 'keep-the-rhythm': return `Keep ${config.bpm} BPM`;
    case 'orbit-pop': return config.twist === 'chaos' ? 'Meteor Shower' : 'Orbit Pop';
    default: return getBreakGame(slug)?.name ?? slug;
  }
}

// ---- Scores ----

export function formatScore(unit: ScoreUnit, score: number): string {
  if (unit === '%') return `${score.toFixed(1)}%`;
  if (unit === 'ms') return `${Math.round(score)} ms`;
  if (unit === 's') return `${score.toFixed(1)}s`;
  return `${Math.round(score)} pts`;
}

const SCORE_MAX: Record<ScoreUnit, number> = { '%': 100, ms: 10_000, s: 999, pts: 1_000_000 };

// Parse a score that arrived in a URL or a postMessage. Returns null when it
// is not a plausible score for this unit, so it never reaches a page or card.
export function parseScore(unit: ScoreUnit, raw: unknown): number | null {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '';
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(text)) return null;
  const value = Math.round(Number(text) * 10) / 10;
  if (!Number.isFinite(value) || value < 0 || value > SCORE_MAX[unit]) return null;
  return unit === 'ms' || unit === 'pts' ? Math.round(value) : value;
}

// ---- Game documents ----

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const BASE_CSS = `*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#131c20;color:#f4f4e9;-webkit-font-smoothing:antialiased;background-image:radial-gradient(ellipse at 80% 90%,#263747 0,transparent 60%)}
button,input{font:inherit}button{cursor:pointer;touch-action:manipulation}button:disabled{cursor:default}
:focus-visible{outline:3px solid #fff;outline-offset:3px}
.screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:44px 16px 16px;text-align:center;gap:12px}
.screen[hidden],[hidden]{display:none!important}
.eyebrow{font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#a6b6b5;margin:0}
h1{font-size:clamp(28px,7vw,44px);letter-spacing:-1.5px;margin:0;line-height:1.05}
p{font-size:14px;line-height:1.55;color:#c3cfcd;margin:0;max-width:460px}
.sub{font-size:12px;color:#9fb0ad}
.go{border:0;background:var(--accent);color:#14201b;font-weight:750;font-size:15px;padding:13px 26px;border-radius:99px;min-height:48px}
.go:active{transform:scale(.97)}
.hud{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;padding:12px 16px;font-size:13px;color:#a6b9b7}
.hud b{color:#fff;font-variant-numeric:tabular-nums}
.final{font-size:clamp(54px,14vw,84px);font-weight:800;color:var(--accent);letter-spacing:-3px;line-height:1;font-variant-numeric:tabular-nums}
.fb{min-height:22px;color:#e6eee9}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}`;

const RUNTIME = `function $(id){return document.getElementById(id)}
function send(ev,x){try{parent.postMessage(Object.assign({source:'inad-game',slug:SLUG,event:ev},x||{}),'*')}catch(e){}}
function show(id){var s=document.querySelectorAll('.screen');for(var i=0;i<s.length;i++)s[i].hidden=s[i].id!==id}
function fmt(v){return UNIT==='%'?v.toFixed(1)+'%':UNIT==='ms'?Math.round(v)+' ms':UNIT==='s'?v.toFixed(1)+'s':String(Math.round(v))}
function sum(a,b){return a+b}
function rng(seed){var a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
var played=false,active=false;
function begin(){active=true;send(played?'replay':'start');played=true;show('game')}
function finish(score,line){if(!active)return;active=false;score=Math.max(0,Math.round(score*10)/10);if(UNIT==='%')score=Math.min(100,score);$('final').textContent=fmt(score);$('resultText').textContent=line||'';show('result');send('complete',{score:score});$('again').focus({preventScroll:true})}
document.addEventListener('keydown',function(e){if(e.key==='Escape')send('hide')});
window.addEventListener('message',function(e){if(e.source!==parent||!e.data||e.data.source!=='arcade-host')return;if(e.data.event==='ready-request')send('ready');if(e.data.event==='start'&&!active)startGame()});
$('start').onclick=function(){startGame()};$('again').onclick=function(){startGame()};
send('ready');`;

type Parts = { css: string; game: string; script: string; intro: string; start: string; gameLabel: string };

function parts(slug: string, config: GameConfig): Parts {
  switch (slug) {
    case 'stop-the-clock': {
      const target = (config.target as number).toFixed(2);
      return {
        intro: `Stop the timer at exactly ${target} seconds. The clock hides after one second, so count in your head. Three tries.`,
        start: 'Start · about 30 sec', gameLabel: 'Stopwatch',
        css: `.clock{font-size:clamp(64px,18vw,110px);font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-3px;line-height:1}.big{min-width:190px;min-height:64px;font-size:18px}`,
        game: `<div class="hud"><span>Try <b id="try">1</b> of 3</span><span>Target <b>${target}s</b></span></div><div class="clock" id="clock">0.00</div><p class="fb" id="fb" role="status" aria-live="polite"></p><button class="go big" id="btn">Start</button>`,
        script: `var tryN=0,results=[],t0=0,raf=0,phase='idle';
function startGame(){tryN=0;results=[];begin();nextTry()}
function nextTry(){tryN++;phase='ready';$('try').textContent=tryN;$('clock').textContent='0.00';$('btn').textContent='Start try '+tryN;$('fb').textContent='Stop at exactly '+CFG.target.toFixed(2)+' seconds.';$('btn').focus({preventScroll:true})}
function tick(){var t=(performance.now()-t0)/1000;$('clock').textContent=t<1?t.toFixed(2):'?.??';raf=requestAnimationFrame(tick)}
$('btn').onclick=function(){if(!active)return;if(phase==='ready'){phase='running';t0=performance.now();$('btn').textContent='Stop';$('fb').textContent='Counting…';raf=requestAnimationFrame(tick)}else if(phase==='running'){var t=(performance.now()-t0)/1000;cancelAnimationFrame(raf);phase='shown';var acc=Math.max(0,100-Math.abs(t-CFG.target)/CFG.target*100);results.push(acc);$('clock').textContent=t.toFixed(2);var d=t-CFG.target;$('fb').textContent=(Math.abs(d)<0.005?'Dead on!':Math.abs(d).toFixed(2)+'s '+(d>0?'late':'early'))+' · '+acc.toFixed(1)+'%';$('btn').textContent=tryN<CFG.tries?'Next try':'See my score'}else if(phase==='shown'){if(tryN<CFG.tries)nextTry();else finish(results.reduce(sum,0)/results.length,'Average accuracy over '+CFG.tries+' tries at '+CFG.target.toFixed(2)+'s.')}};`,
      };
    }
    case 'split-the-bar':
      return {
        intro: 'Cut an empty bar at a percentage, like 37%. No ruler and no tick marks. Five cuts.',
        start: 'Start · about 40 sec', gameLabel: 'Bar to cut',
        css: `.ask{font-size:clamp(26px,6vw,38px);font-weight:750}.ask b{color:var(--accent)}.barwrap{width:min(560px,92%)}.bar{position:relative;height:64px;border-radius:14px;background:#24323a;border:1px solid #8ca49d55;cursor:crosshair;overflow:hidden;touch-action:none}.fill{position:absolute;left:0;top:0;bottom:0;width:0;background:var(--accent);opacity:.3}.mark,.truth{position:absolute;top:0;bottom:0;width:3px;margin-left:-1.5px}.mark{background:#fff}.truth{background:var(--accent);box-shadow:0 0 12px var(--accent)}.ends{display:flex;justify-content:space-between;font-size:12px;color:#9fb0ad;margin-top:6px}`,
        game: `<div class="hud"><span>Cut <b id="rn">1</b> of 5</span><span>Score <b id="sc">–</b></span></div><div class="ask">Cut at <b id="tg"></b>%</div><div class="barwrap"><div id="bar" class="bar" tabindex="0" role="slider" aria-label="Where to cut. Arrow keys move, Enter cuts." aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><span class="fill" id="fill"></span><span class="mark" id="mark" hidden></span><span class="truth" id="truth" hidden></span></div><div class="ends" aria-hidden="true"><span>0</span><span>100</span></div></div><p class="fb" id="fb" role="status" aria-live="polite"></p><button class="go" id="next" hidden>Next cut</button>`,
        script: `var r=0,scores=[],kb=50,locked=false;
function startGame(){r=0;scores=[];$('sc').textContent='–';begin();round()}
function round(){locked=false;kb=50;$('rn').textContent=r+1;$('tg').textContent=CFG.targets[r];$('fill').style.width='0';$('mark').hidden=true;$('truth').hidden=true;$('next').hidden=true;$('fb').textContent='Tap the bar where '+CFG.targets[r]+'% is.';$('bar').setAttribute('aria-valuenow','50');$('bar').focus({preventScroll:true})}
function cut(p){if(locked||!active)return;locked=true;p=Math.max(0,Math.min(100,p));var t=CFG.targets[r],err=Math.abs(p-t),pts=Math.max(0,100-err*4);scores.push(pts);$('fill').style.width=p+'%';$('mark').style.left=p+'%';$('mark').hidden=false;$('truth').style.left=t+'%';$('truth').hidden=false;$('fb').textContent='You cut at '+p.toFixed(1)+'%. Off by '+err.toFixed(1)+' · '+pts.toFixed(0)+' points';$('sc').textContent=(scores.reduce(sum,0)/scores.length).toFixed(1)+'%';$('next').hidden=false;$('next').textContent=r<CFG.targets.length-1?'Next cut':'See my score';$('next').focus({preventScroll:true})}
$('bar').addEventListener('pointerdown',function(e){var b=$('bar').getBoundingClientRect();cut((e.clientX-b.left)/b.width*100)});
$('bar').addEventListener('keydown',function(e){if(locked)return;var step=e.shiftKey?5:1;if(e.key==='ArrowRight'||e.key==='ArrowUp'){kb=Math.min(100,kb+step)}else if(e.key==='ArrowLeft'||e.key==='ArrowDown'){kb=Math.max(0,kb-step)}else if(e.key==='Enter'||e.key===' '){e.preventDefault();cut(kb);return}else return;e.preventDefault();$('mark').hidden=false;$('mark').style.left=kb+'%';$('bar').setAttribute('aria-valuenow',String(kb))});
$('next').onclick=function(){r++;if(r<CFG.targets.length)round();else finish(scores.reduce(sum,0)/scores.length,'Average accuracy over five cuts.')};`,
      };
    case 'dot-flash':
      return {
        intro: 'Dots flash for under a second. Guess how many there were. Five flashes, each busier than the last.',
        start: 'Start · about 45 sec', gameLabel: 'Dot estimation',
        css: `.field{position:relative;width:min(520px,94%);height:min(42vh,230px);flex-shrink:0;border-radius:16px;background:#1d2a30;border:1px solid #8ca49d40}.dot{position:absolute;width:10px;height:10px;margin:-5px;border-radius:50%;background:var(--accent)}.guess{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}.guess label{font-size:14px;color:#d8e2dc}.guess input{width:96px;font-size:20px;padding:10px;border-radius:12px;border:1px solid #8ca49d80;background:#0f171a;color:#fff;text-align:center}`,
        game: `<div class="hud"><span>Flash <b id="rn">1</b> of 5</span><span>Score <b id="sc">–</b></span></div><div class="field" id="field" aria-hidden="true"></div><div id="f" class="guess" hidden><label for="g">How many dots?</label><input id="g" type="number" inputmode="numeric" min="0" max="999" enterkeyhint="done"><button class="go" type="button" id="guess">Guess</button></div><p class="fb" id="fb" role="status" aria-live="polite"></p><button class="go" id="next" hidden>Next flash</button>`,
        script: `var r=0,scores=[],R=rng(CFG.seed),layouts=[],timer=0;
for(var i=0;i<CFG.counts.length;i++){var pts=[];for(var k=0;k<CFG.counts[i];k++){var x,y,ok,n=0;do{x=4+R()*92;y=7+R()*86;ok=true;for(var j=0;j<pts.length;j++){if(Math.abs(pts[j][0]-x)<3.4&&Math.abs(pts[j][1]-y)<6){ok=false;break}}n++}while(!ok&&n<50);pts.push([x,y])}layouts.push(pts)}
function draw(n){var f=$('field');f.innerHTML='';if(n<0)return;layouts[n].forEach(function(p){var d=document.createElement('span');d.className='dot';d.style.left=p[0]+'%';d.style.top=p[1]+'%';f.appendChild(d)})}
function startGame(){r=0;scores=[];$('sc').textContent='–';begin();round()}
function round(){clearTimeout(timer);$('rn').textContent=r+1;$('f').hidden=true;$('next').hidden=true;$('g').value='';$('fb').textContent='Get ready…';draw(-1);timer=setTimeout(function(){draw(r);$('fb').textContent='Look!';timer=setTimeout(function(){draw(-1);$('f').hidden=false;$('fb').textContent='';$('g').focus({preventScroll:true})},850)},800)}
// Sandboxed frames without allow-forms block form submission, so no form element.
$('guess').onclick=guess;$('g').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();guess()}});
function guess(){var g=parseInt($('g').value,10);if(isNaN(g)||!active)return;var n=CFG.counts[r],acc=Math.max(0,100-Math.abs(g-n)/n*100);scores.push(acc);$('f').hidden=true;draw(r);$('fb').textContent='There were '+n+'. You said '+g+' · '+acc.toFixed(0)+' points';$('sc').textContent=(scores.reduce(sum,0)/scores.length).toFixed(1)+'%';$('next').hidden=false;$('next').textContent=r<CFG.counts.length-1?'Next flash':'See my score';$('next').focus({preventScroll:true})}
$('next').onclick=function(){r++;if(r<CFG.counts.length)round();else finish(scores.reduce(sum,0)/scores.length,'Average accuracy over five flashes.')};`,
      };
    case 'color-recall':
      return {
        intro: 'A color shows for three seconds. Then rebuild it from memory with three sliders. Three colors.',
        start: 'Start · about 1 min', gameLabel: 'Color memory',
        css: `.sw{display:flex;gap:12px}.swatch{width:min(150px,36vw);height:min(110px,22vh);border-radius:18px;border:1px solid #ffffff30}.sliders{display:grid;gap:8px;width:min(420px,94%)}.sliders label{display:grid;grid-template-columns:90px 1fr;align-items:center;font-size:13px;color:#d8e2dc;text-align:left}.sliders input{width:100%;min-height:32px;accent-color:var(--accent)}`,
        game: `<div class="hud"><span>Color <b id="rn">1</b> of 3</span><span>Score <b id="sc">–</b></span></div><div class="sw"><div class="swatch" id="target" role="img" aria-label="The color to remember"></div><div class="swatch" id="mine" role="img" aria-label="Your color" hidden></div></div><p class="fb" id="fb" role="status" aria-live="polite"></p><div class="sliders" id="sl" hidden><label>Hue<input type="range" id="h" min="0" max="359"></label><label>Saturation<input type="range" id="s" min="0" max="100"></label><label>Lightness<input type="range" id="l" min="0" max="100"></label><button class="go" id="lock">Lock it in</button></div><button class="go" id="next" hidden>Next color</button>`,
        script: `var r=0,scores=[],timer=0;
function hsl(c){return 'hsl('+c.h+','+c.s+'%,'+c.l+'%)'}
function cur(){return {h:+$('h').value,s:+$('s').value,l:+$('l').value}}
function paint(){$('mine').style.background=hsl(cur())}
['h','s','l'].forEach(function(id){$(id).addEventListener('input',paint)});
function startGame(){r=0;scores=[];$('sc').textContent='–';begin();round()}
function round(){clearInterval(timer);var c=CFG.colors[r],left=3;$('rn').textContent=r+1;$('sl').hidden=true;$('next').hidden=true;$('mine').hidden=true;$('target').hidden=false;$('target').style.background=hsl(c);$('fb').textContent='Remember this color… '+left;timer=setInterval(function(){left--;if(left>0){$('fb').textContent='Remember this color… '+left}else{clearInterval(timer);$('target').hidden=true;$('h').value=180;$('s').value=50;$('l').value=50;paint();$('mine').hidden=false;$('sl').hidden=false;$('fb').textContent='Now make it again.';$('h').focus({preventScroll:true})}},1000)}
$('lock').onclick=function(){if(!active)return;var c=CFG.colors[r],m=cur(),dh=Math.abs(c.h-m.h);dh=Math.min(dh,360-dh)/1.8;var err=(dh+Math.abs(c.s-m.s)*0.5+Math.abs(c.l-m.l))/2.5,acc=Math.max(0,100-err*2.5);scores.push(acc);$('sl').hidden=true;$('target').hidden=false;$('fb').textContent='Left: the real color. Right: yours · '+acc.toFixed(0)+' points';$('sc').textContent=(scores.reduce(sum,0)/scores.length).toFixed(1)+'%';$('next').hidden=false;$('next').textContent=r<CFG.colors.length-1?'Next color':'See my score';$('next').focus({preventScroll:true})};
$('next').onclick=function(){r++;if(r<CFG.colors.length)round();else finish(scores.reduce(sum,0)/scores.length,'Average match over three colors.')};`,
      };
    case 'keep-the-rhythm':
      return {
        intro: `Tap along with a silent pulse at ${config.bpm} BPM. After four beats it disappears. Keep the beat for 16 taps.`,
        start: 'Start · about 20 sec', gameLabel: 'Rhythm tapping',
        css: `.pulse{width:110px;height:110px;border-radius:50%;border:3px solid var(--accent);opacity:.35;transition:opacity .5s}.pulse.on{background:var(--accent);opacity:1;transition:none}.pulse.gone{opacity:.06}.tap{min-width:220px;min-height:84px;font-size:22px;user-select:none;-webkit-user-select:none}`,
        game: `<div class="hud"><span>Taps <b id="n">0</b> / 16</span><span><b>${config.bpm}</b> BPM</span></div><div class="pulse" id="pulse" aria-hidden="true"></div><p class="fb" id="fb" role="status" aria-live="polite"></p><button class="go tap" id="tap">Tap</button>`,
        script: `var I=60000/CFG.bpm,taps=[],vanish=0,timers=[];
function clearAll(){timers.forEach(clearTimeout);timers=[]}
function startGame(){taps=[];clearAll();begin();$('n').textContent='0';$('pulse').className='pulse';$('fb').textContent='Tap with the pulse. It fades after 4 beats. Keep going.';var t0=performance.now()+600;vanish=t0+I*(CFG.beats-0.5);for(var b=0;b<CFG.beats;b++){(function(b){timers.push(setTimeout(function(){$('pulse').className='pulse on';timers.push(setTimeout(function(){$('pulse').className=b===CFG.beats-1?'pulse gone':'pulse'},120))},600+I*b))})(b)}timers.push(setTimeout(function(){if(active)score()},600+I*(CFG.taps+6)));$('tap').focus({preventScroll:true})}
function tap(){if(!active)return;taps.push(performance.now());$('n').textContent=taps.length;if(taps.length>=CFG.taps)score()}
function score(){clearAll();var errs=[];for(var i=1;i<taps.length;i++){if(taps[i]>vanish)errs.push(Math.abs((taps[i]-taps[i-1])-I)/I)}if(errs.length<3){finish(0,'Not enough taps after the pulse faded. Keep tapping next time.');return}var m=errs.reduce(sum,0)/errs.length;finish(Math.max(0,100-m*200),'Average drift '+Math.round(m*I)+' ms per beat at '+CFG.bpm+' BPM.')}
$('tap').addEventListener('pointerdown',function(e){e.preventDefault();tap()});$('tap').addEventListener('keydown',function(e){if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();tap()}});`,
      };
    case 'green-means-go':
      return {
        intro: 'Wait for the panel to turn green, then tap as fast as you can. Tap early and that try restarts. Five tries.',
        start: 'Start · about 30 sec', gameLabel: 'Reaction test',
        css: `.pad{width:min(520px,94%);height:min(48vh,250px);border-radius:20px;border:0;font-size:clamp(22px,5vw,32px);font-weight:800;background:#4a2a2e;color:#ffd9d2;user-select:none;-webkit-user-select:none}.pad.now{background:var(--accent);color:#13221a}.pad.idle{background:#24323a;color:#e7efe9}`,
        game: `<div class="hud"><span>Try <b id="rn">1</b> of 5</span><span>Average <b id="avg">–</b></span></div><button class="pad" id="pad">Wait for green…</button><p class="fb" id="fb" role="status" aria-live="polite"></p>`,
        script: `var r=0,times=[],state='idle',t=0,timer=0;
function startGame(){r=0;times=[];$('avg').textContent='–';begin();arm();$('pad').focus({preventScroll:true})}
function arm(){clearTimeout(timer);state='wait';$('rn').textContent=r+1;$('pad').className='pad';$('pad').textContent='Wait for green…';timer=setTimeout(function(){state='now';t=performance.now();$('pad').className='pad now';$('pad').textContent='GO!'},CFG.delays[r])}
function avg(){return times.reduce(sum,0)/times.length}
function press(){if(!active)return;if(state==='wait'){clearTimeout(timer);state='early';$('pad').className='pad idle';$('pad').textContent='Too soon! Tap to retry';$('fb').textContent='Wait for green, then tap.'}else if(state==='early'){$('fb').textContent='';arm()}else if(state==='now'){var ms=performance.now()-t;times.push(ms);$('pad').className='pad idle';$('avg').textContent=Math.round(avg())+' ms';if(times.length>=CFG.delays.length){state='done';$('pad').textContent=Math.round(ms)+' ms';setTimeout(function(){finish(avg(),'Average of five reactions. Lower is better.')},700)}else{state='between';$('pad').textContent=Math.round(ms)+' ms · tap for the next try'}}else if(state==='between'){r++;$('fb').textContent='';arm()}}
$('pad').addEventListener('pointerdown',function(e){e.preventDefault();press()});$('pad').addEventListener('keydown',function(e){if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();press()}});`,
      };
    case 'number-hunt':
      return {
        intro: 'Twenty-five numbers, scrambled. Tap them in order from 1 to 25 as fast as you can.',
        start: 'Start · about 40 sec', gameLabel: 'Number grid',
        css: `.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;width:min(380px,92vw,calc(100vh - 120px));aspect-ratio:1}.cell{border:1px solid #8ca49d45;background:#1f2c32;color:#eef3ef;border-radius:10px;font-size:clamp(16px,4.5vw,24px);font-weight:700;min-height:0;padding:0}.cell:hover:not(:disabled){border-color:var(--accent)}.cell.done{opacity:.22}.cell.miss{background:#6a2e2e}`,
        game: `<div class="hud"><span>Find <b id="want">1</b></span><span><b id="clock">0.0</b>s</span></div><div class="grid" id="grid" role="group" aria-label="Numbers 1 to 25"></div><p class="fb" id="fb" role="status" aria-live="polite"></p>`,
        script: `var want=1,t0=0,timer=0,cells=[];
for(var i=0;i<25;i++){var b=document.createElement('button');b.className='cell';b.type='button';(function(b){b.onclick=function(){hit(b)}})(b);$('grid').appendChild(b);cells.push(b)}
function startGame(){want=1;clearInterval(timer);begin();cells.forEach(function(b,i){var n=CFG.order[i];b.textContent=n;b.dataset.n=n;b.className='cell';b.disabled=false;b.setAttribute('aria-label','Number '+n)});$('want').textContent='1';$('clock').textContent='0.0';$('fb').textContent='Tap 1 to 25 in order.';t0=performance.now();timer=setInterval(function(){$('clock').textContent=((performance.now()-t0)/1000).toFixed(1)},100);cells[0].focus({preventScroll:true})}
function hit(b){if(!active)return;if(+b.dataset.n===want){var had=document.activeElement===b;b.className='cell done';b.disabled=true;want++;if(want>25){clearInterval(timer);finish((performance.now()-t0)/1000,'Time to find 1 to 25. Lower is better.');return}$('want').textContent=want;$('fb').textContent='';if(had){var nx=cells.filter(function(c){return !c.disabled})[0];if(nx)nx.focus({preventScroll:true})}}else{b.className='cell miss';setTimeout(function(){if(b.className==='cell miss')b.className='cell'},250);$('fb').textContent='That is '+b.dataset.n+'. Looking for '+want+'.'}}`,
      };
    default:
      throw new Error(`No document for ${slug}`);
  }
}

// Full HTML document for one seeded variant of a game. The document posts
// {source:'inad-game', slug, event:'ready'|'start'|'replay'|'complete'|'hide', score?}
// to its parent and accepts {source:'arcade-host', event:'start'|'ready-request'}.
export function createBreakGameHtml(slug: string, seed: number): string {
  const game = getBreakGame(slug);
  if (!game) throw new Error(`Unknown break game: ${slug}`);
  const config = makeConfig(slug, seed);
  if (slug === 'orbit-pop') return createOrbitPopHtml(config.twist as 'classic' | 'chaos', false);
  const p = parts(slug, config);
  const title = escapeHtml(variantTitle(slug, config));
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>${BASE_CSS}body{--accent:${game.accent}}${p.css}</style></head><body>
<section id="intro" class="screen"><div class="eyebrow">${escapeHtml(game.roundLabel)} · no sound</div><h1>${title}</h1><p>${escapeHtml(p.intro)}</p><button class="go" id="start">${escapeHtml(p.start)}</button><p class="sub">Works with a mouse, a finger or the keyboard.</p></section>
<section id="game" class="screen" hidden aria-label="${escapeHtml(p.gameLabel)}">${p.game}</section>
<section id="result" class="screen" hidden><div class="eyebrow">Your ${escapeHtml(game.scoreLabel)}</div><div class="final" id="final"></div><p id="resultText"></p><button class="go" id="again">Play again ↻</button></section>
<script>var SLUG=${json(slug)},CFG=${json(config)},UNIT=${json(game.unit)};
${p.script}
${RUNTIME}</script></body></html>`;
}
