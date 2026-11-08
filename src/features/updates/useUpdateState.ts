import { useSettings, useUpdateCheck } from '@/data/hooks';
import type { UpdateState } from '@/domain/updates';

function instant(ms: number): string | null {
  return ms > 0 ? new Date(ms).toISOString() : null;
}

/** What the update check has come to, for the bar and for Settings. */
export function useUpdateState(): {
  state: UpdateState;
  check: ReturnType<typeof useUpdateCheck>;
} {
  const settings = useSettings();
  const check = useUpdateCheck();
  const on = settings.data?.updateCheck === true;

  let state: UpdateState;
  if (!on) state = { kind: 'off' };
  else if (check.isFetching) state = { kind: 'checking' };
  else if (check.isError) state = { kind: 'unreachable', checkedAt: instant(check.dataUpdatedAt) };
  else if (check.isSuccess && check.data !== null)
    state = { kind: 'available', found: check.data, checkedAt: instant(check.dataUpdatedAt) ?? '' };
  else if (check.isSuccess)
    state = { kind: 'newest', checkedAt: instant(check.dataUpdatedAt) ?? '' };
  else state = { kind: 'checking' };
  return { state, check };
}
