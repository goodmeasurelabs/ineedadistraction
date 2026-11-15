import type { Metadata } from 'next';
import DailyView, { dailyMetadata } from './DailyView';
import { utcDate } from '../lib/daily';

export const dynamic = 'force-dynamic';

type Search = Promise<{ score?: string }>;

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  return dailyMetadata(utcDate(), (await searchParams).score, false);
}

export default async function DailyPage({ searchParams }: { searchParams: Search }) {
  return <DailyView date={utcDate()} rawScore={(await searchParams).score} />;
}
