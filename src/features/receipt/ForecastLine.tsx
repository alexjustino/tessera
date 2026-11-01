import { MIN_SAMPLE, type Forecast } from '@/domain/confidence';
import { describeDay } from '@/features/reports/format';

/**
 * A projected finish, said once for every screen that shows one (M2).
 *
 * The plain day comes first — the estimates as typed. The range follows only
 * when there is history enough, and says how much history it stands on; below
 * the sample it says how much is missing instead of showing a percentage it
 * cannot back (SPEC 1.3, ADR-035).
 */
export function ForecastLine({
  forecast,
  sample,
  dueDay,
  rangeOnly = false,
}: {
  forecast: Forecast;
  sample: number;
  /** When given, a finish after it is said in words. */
  dueDay?: string | null;
  /**
   * Only the range (or what is missing for one), in the surrounding text's
   * size — for the receipt, whose own line already says the plain day. Saying
   * it twice was the first capture's finding.
   */
  rangeOnly?: boolean;
}) {
  if (rangeOnly) {
    if (forecast.plain === null) return null;
    return <p data-testid="forecast">{rangeOf(forecast, sample)}</p>;
  }

  if (forecast.plain === null) {
    return (
      <p data-testid="forecast" className="text-caption text-fg-secondary">
        Does not fit in the next year of working hours.
      </p>
    );
  }

  const late = dueDay !== undefined && dueDay !== null && forecast.plain > dueDay;

  return (
    <p data-testid="forecast" className="text-caption text-fg-secondary">
      On the estimates as typed, done by {describeDay(forecast.plain)}
      {late ? ' — after its date' : ''}. {rangeOf(forecast, sample)}
    </p>
  );
}

function rangeOf(forecast: Forecast, sample: number) {
  const { likely, sure } = forecast;
  if (likely !== null && sure !== null) {
    return (
      <span data-testid="forecast-range">
        Likely by {describeDay(likely)}; 85% sure by {describeDay(sure)} — from {sample} finished{' '}
        {sample === 1 ? 'task' : 'tasks'}.
      </span>
    );
  }
  return (
    <span data-testid="forecast-sample">
      Dates become ranges after {MIN_SAMPLE} finished tasks with an estimate and tracked time (
      {sample} so far).
    </span>
  );
}
