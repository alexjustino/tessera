import { useSaveSettings, useSettings } from '@/data/hooks';
import type { Settings } from '@/domain/settings';

/** Remember an answer in the settings, keeping everything else as it is. */
export function useGuideAnswer() {
  const settings = useSettings();
  const save = useSaveSettings();
  return (patch: Partial<Settings>) => {
    if (settings.data !== undefined) save.mutate({ ...settings.data, ...patch });
  };
}
