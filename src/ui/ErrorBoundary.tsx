import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from './Button';
import { InfoBar } from './InfoBar';

/**
 * What stands between one screen failing and the window going blank.
 *
 * A render that throws takes everything above it down unless something catches
 * it, and a white window with no way out says nothing, not even that the work is
 * safe. So a screen fails on its own: it says so, and the rail stays alive.
 *
 * Keyed by the caller on the screen it holds, so going somewhere else clears it.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; onLeave?: () => void },
  { failure: Error | null }
> {
  override state: { failure: Error | null } = { failure: null };

  static getDerivedStateFromError(failure: Error) {
    return { failure };
  }

  override componentDidCatch(failure: Error, info: ErrorInfo) {
    console.error('A screen failed to render', failure, info.componentStack);
  }

  override render() {
    const { failure } = this.state;
    if (failure === null) return this.props.children;
    return (
      <div className="flex flex-col gap-3 p-6" data-testid="screen-failed">
        <InfoBar severity="danger" title="This screen could not be shown">
          Your work is safe: nothing on this screen was written. The reason was:{' '}
          <span data-selectable>{failure.message}</span>
        </InfoBar>
        <div>
          <Button onClick={() => this.setState({ failure: null })}>Try again</Button>
        </div>
      </div>
    );
  }
}
