import { useState } from 'react';

import { describeError } from '@/data/errors';
import { useInstallUpdate } from '@/data/hooks';
import { notesPreview } from '@/domain/updates';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';

import { useUpdateState } from './useUpdateState';

/**
 * A newer release, said once at the top of the window (ADR-062). Nothing is
 * downloaded until Install is pressed; Later hides it until Tessera starts again.
 */
export function UpdateBar() {
  const { state } = useUpdateState();
  const install = useInstallUpdate();
  const [later, setLater] = useState<string | null>(null);

  if (state.kind !== 'available' || later === state.found.version) return null;
  const { found } = state;
  const lines = notesPreview(found.notes);

  return (
    <div className="flex flex-col gap-2 px-6 pt-4" data-testid="update-bar">
      <InfoBar title={`Tessera ${found.version} is ready`}>
        {lines.length > 0 && (
          <ul className="list-disc pl-5">
            {lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
        <p className="mt-1">
          Installing restarts Tessera. Your workspace stays where it is, and the installer is
          checked against Tessera&apos;s own key before it runs.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Button appearance="accent" disabled={install.isPending} onClick={() => install.mutate()}>
            {install.isPending ? 'Installing…' : 'Install and restart'}
          </Button>
          <Button
            appearance="subtle"
            disabled={install.isPending}
            onClick={() => setLater(found.version)}
          >
            Later
          </Button>
        </div>
      </InfoBar>
      {install.error !== null && (
        <InfoBar severity="danger" title="The update was not installed">
          {describeError(install.error)}
        </InfoBar>
      )}
    </div>
  );
}
