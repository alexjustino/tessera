import type { ReactNode } from 'react';

/**
 * A destination's frame: it fills the window it is given.
 *
 * Every screen used to set its own narrow maximum, so a maximised window kept
 * the same column with empty space around it. The cap here only stops lines
 * running absurdly long on a very wide monitor.
 */
export function Page({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`mx-auto flex w-full max-w-[120rem] flex-col gap-4 p-6 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Cards that spread across the room there is: one column in a small window, two
 * when it is wide, three on a very wide one. Each card stays whole.
 */
export function PageColumns({ children }: { children: ReactNode }) {
  return (
    <div className="gap-4 xl:columns-2 min-[1900px]:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid [&>*:last-child]:mb-0">
      {children}
    </div>
  );
}
