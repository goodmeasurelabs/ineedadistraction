import type { Metadata } from 'next';
import ArcadeClient from './ArcadeClient';
import '../games/games.css';
import './arcade.css';

export const metadata: Metadata = {
  title: 'Your distraction · I Need a Distraction',
  description: 'Your game mix, beside your coding agent. Easy to pause. Easy to pick up again.',
  robots: { index: false, follow: false },
};

const SHAPE_POPUP = `(function(){try{if(/&popup$/.test(location.hash)){var w=460,h=Math.min(800,screen.availHeight);resizeTo(w,h);moveTo(screen.availWidth-w-24,Math.max(0,(screen.availHeight-h)/2))}}catch(e){}})()`;

export default function ArcadePage() {
  return <><script dangerouslySetInnerHTML={{ __html: SHAPE_POPUP }} /><ArcadeClient /></>;
}
