import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Make your game · I Need a Distraction', robots: { index: false, follow: true } };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
