import { Keyboard20Regular } from '@fluentui/react-icons';

import { showCapture } from '@/data/capture';
import { describeError } from '@/data/errors';
import { useCaptureStatus } from '@/data/hooks';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';
import { Kbd } from '@/ui/Kbd';

/**
 * Whether the quick-capture shortcut is live, shown rather than assumed.
 *
 * A global shortcut can be owned by another program, in which case pressing it
 * does nothing — and nothing is the one outcome a person cannot diagnose. So
 * the registration result is read back from the host and said here.
 */
export function CaptureCard() {
  const status = useCaptureStatus();

  return (
    <Card
      title="Quick capture"
      description="One line becomes a task, from anywhere, without opening the window."
      actions={
        <Button appearance="subtle" icon={<Keyboard20Regular />} onClick={() => void showCapture()}>
          Open quick capture
        </Button>
      }
    >
      {status.error ? (
        <InfoBar severity="danger" title="The host did not answer">
          {describeError(status.error)}
        </InfoBar>
      ) : status.data ? (
        status.data.registered ? (
          <InfoBar severity="success" title="The shortcut is live">
            Press <Kbd>{status.data.shortcut}</Kbd> in any program to open the capture line. It is
            also in the tray menu and the command palette.
          </InfoBar>
        ) : (
          <InfoBar severity="caution" title={`${status.data.shortcut} could not be registered`}>
            {status.data.problem ?? 'Another program owns this key combination.'} Quick capture
            still opens from the tray menu and from the command palette.
          </InfoBar>
        )
      ) : (
        <div className="h-12 animate-pulse rounded-md bg-card-hover" />
      )}
    </Card>
  );
}
