import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import DailyView, { dailyMetadata } from '../DailyView';
import { isPlayableDailyDate, utcDate } from '../../lib/daily';

export const dynamic = 'force-dynamic';

type Params = Promise<{ date: string }>;
type Search = Promise<{ score?: string }>;

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { date } = await params;
  if (!isPlayableDailyDate(date)) return { title: 'Daily not found · I Need a Distraction', robots: { index: false, follow: false } };
  return dailyMetadata(date, (await searchParams).score, date !== utcDate());
}

export default async function DailyDatePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { date } = await params;
  if (!isPlayableDailyDate(date)) notFound();
  return <DailyView date={date} rawScore={(await searchParams).score} />;
}
