import { ArrowDownload20Regular, ArrowSync20Regular } from '@fluentui/react-icons';
import { useQueryClient } from '@tanstack/react-query';

import { describeError } from '@/data/errors';
import { updateKey, useInstallUpdate } from '@/data/hooks';
import { describeUpdate } from '@/domain/updates';
import { useUpdateState } from '@/features/updates/useUpdateState';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { SettingGroup, SettingRow } from '@/ui/Setting';
import { Toggle } from '@/ui/Toggle';
import { useNow } from '@/ui/useNow';

/**
 * Updates (ADR-062): the one switch between Tessera and the network, what the
 * last check said, and a way to ask now.
 */
export function UpdatesGroup({
  on,
  saving,
  onChange,
}: {
  on: boolean;
  saving: boolean;
  onChange: (on: boolean) => void;
}) {
  const client = useQueryClient();
  const { state, check } = useUpdateState();
  const install = useInstallUpdate();
  const now = useNow(60_000);

  const turn = (next: boolean) => {
    // Off forgets what the last check found, so nothing offers an update after the door is shut.
    if (!next) client.removeQueries({ queryKey: updateKey });
    onChange(next);
  };

  return (
    <SettingGroup title="Updates">
      <SettingRow
        icon={<ArrowSync20Regular />}
        title="Check for updates"
        description="Once a day, Tessera asks GitHub whether a newer release exists. Nothing about you or your work is sent. Off, Tessera makes no request at all."
      >
        <Toggle checked={on} label="Check for updates" disabled={saving} onChange={turn} />
      </SettingRow>
      <SettingRow
        icon={<ArrowDownload20Regular />}
        title="This copy"
        description={<span data-testid="update-status">{describeUpdate(state, now)}</span>}
      >
        <div className="flex flex-wrap gap-1">
          <Button
            appearance="standard"
            disabled={!on || check.isFetching}
            onClick={() => void check.refetch()}
          >
            Check now
          </Button>
          {state.kind === 'available' && (
            <Button
              appearance="accent"
              disabled={install.isPending}
              onClick={() => install.mutate()}
            >
              {install.isPending ? 'Installing…' : 'Install and restart'}
            </Button>
          )}
        </div>
      </SettingRow>
      {install.error !== null && (
        <div className="px-4 pb-3">
          <InfoBar severity="danger" title="The update was not installed">
            {describeError(install.error)}
          </InfoBar>
        </div>
      )}
    </SettingGroup>
  );
}
