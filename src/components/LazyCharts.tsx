import type { ReactNode } from 'react';
import { CodeBoundary, ReloadButton } from './CodeBoundary';
import { lazyComponent } from './lazyComponent';

/**
 * The dashboard's charts. They need the chart libraries, about 750 kB of script, so the
 * browser fetches them after the dashboard is on screen.
 */
const charts = {
  genres: lazyComponent(
    async () => (await import('./GenreDistributionChart')).GenreDistributionChart
  ),
  globalGenres: lazyComponent(
    async () => (await import('./GlobalGenreDistributionChart')).GlobalGenreDistributionChart
  ),
  dailyListening: lazyComponent(
    async () => (await import('./DailyListeningChart')).DailyListeningChart
  ),
  weeklyHabits: lazyComponent(
    async () => (await import('./WeeklyListeningHabitsChart')).WeeklyListeningHabitsChart
  ),
  heatmap: lazyComponent(
    async () => (await import('./ListeningActivityHeatmap')).ListeningActivityHeatmap
  ),
  tracksAdded: lazyComponent(
    async () => (await import('./WeeklyTracksAddedChart')).WeeklyTracksAddedChart
  ),
};

export const GenreDistributionChart = charts.genres.Component;
export const GlobalGenreDistributionChart = charts.globalGenres.Component;
export const DailyListeningChart = charts.dailyListening.Component;
export const WeeklyListeningHabitsChart = charts.weeklyHabits.Component;
export const ListeningActivityHeatmap = charts.heatmap.Component;
export const WeeklyTracksAddedChart = charts.tracksAdded.Component;

const CARD = 'rounded-lg border border-white/[0.08] bg-[#12141A]';

interface ChartBoundaryProps {
  children: ReactNode;
  /** Sizes the card that holds the chart's place. Give it the chart's own grid classes. */
  className: string;
}

/**
 * Wraps one chart. An empty card holds its place while the code is on the way, and a chart
 * that fails to load or to draw shows a message in that card while the rest of the dashboard
 * keeps working.
 */
export function ChartBoundary({ children, className }: ChartBoundaryProps) {
  return (
    <CodeBoundary
      waiting={<div aria-busy="true" className={`${CARD} ${className}`} />}
      failed={
        <div
          role="alert"
          className={`${CARD} ${className} flex flex-col items-center justify-center gap-4 px-6 text-center`}
        >
          <p className="text-sm text-[#B8BECB]">
            This chart did not load. Reload the page to try again.
          </p>
          <ReloadButton />
        </div>
      }
    >
      {children}
    </CodeBoundary>
  );
}
