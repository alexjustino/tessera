import type { ReactNode } from 'react';

/**
 * Settings the way Windows 11 lays them out: a heading, then one card of rows,
 * each with what it is on the left and the control on the right.
 *
 * A screen of options reads as polluted when each one is its own box with its own
 * paragraph. Here the sentence is one line, and the rows share one surface.
 */
export function SettingGroup({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string | undefined;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      {(title !== undefined || actions !== undefined) && (
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title !== undefined && <h2 className="text-body-lg font-semibold text-fg">{title}</h2>}
            {description !== undefined && (
              <p className="mt-0.5 text-caption text-fg-tertiary">{description}</p>
            )}
          </div>
          {actions}
        </header>
      )}
      <div className="divide-y divide-stroke-subtle rounded-xl border border-stroke-subtle bg-card shadow-card">
        {children}
      </div>
    </section>
  );
}

/** One thing that can be set: its name, one line on what it does, and the control. */
export function SettingRow({
  icon,
  title,
  description,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      {icon !== undefined && (
        <span aria-hidden="true" className="flex shrink-0 text-fg-secondary">
          {icon}
        </span>
      )}
      <div className="min-w-48 flex-1">
        <div className="text-body text-fg">{title}</div>
        {description !== undefined && (
          <div className="mt-0.5 text-caption text-fg-tertiary">{description}</div>
        )}
      </div>
      {children !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}

/** A row's own content, when it is more than a name and a control. */
export function SettingBody({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3">{children}</div>;
}
