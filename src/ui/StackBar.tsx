/** One part of a whole. `className` is the fill, from the tokens. */
export interface StackPart {
  id: string;
  label: string;
  value: number;
  /** The reading in words. */
  text: string;
  className: string;
  /** A fill the token layer holds as a colour rather than a utility. */
  style?: React.CSSProperties;
}

/**
 * Parts of one whole, side by side, with a legend that says each in words.
 *
 * The gaps between parts are what separates them. Parts with nothing in them
 * stay in the legend, so the count of what exists does not change with the data.
 */
export function StackBar({
  parts,
  label,
  showEmpty = true,
}: {
  parts: readonly StackPart[];
  /** What the whole is. */
  label: string;
  showEmpty?: boolean;
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const listed = showEmpty ? parts : parts.filter((part) => part.value > 0);

  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`${label}: ${parts.map((part) => `${part.label} ${part.text}`).join(', ')}`}
        className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-card-active"
      >
        {total > 0 &&
          parts
            .filter((part) => part.value > 0)
            .map((part) => (
              <span
                key={part.id}
                title={`${part.label}: ${part.text}`}
                className={`h-full min-w-1 ${part.className}`}
                style={{ width: `${(part.value / total) * 100}%`, ...part.style }}
              />
            ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {listed.map((part) => (
          <li key={part.id} className="flex items-center gap-1.5 text-caption text-fg-secondary">
            <span
              aria-hidden="true"
              className={`size-2.5 shrink-0 rounded-sm ${part.className}`}
              style={part.style}
            />
            {part.label}
            <span className="font-semibold text-fg">{part.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
