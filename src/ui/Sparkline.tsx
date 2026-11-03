/**
 * A few readings as one thin line, with the latest marked.
 *
 * It decorates a number that is already written beside it, so it speaks once, in
 * words, and has no axis of its own. Nothing here sets a colour but the tokens.
 */
export function Sparkline({
  values,
  label,
  className = '',
}: {
  values: readonly number[];
  /** What the line shows. Spoken, and shown as the tooltip. */
  label: string;
  className?: string;
}) {
  const width = 64;
  const height = 24;
  const inset = 4;
  const top = Math.max(...values, 1);
  const at = (value: number, index: number) => ({
    x: inset + (index / Math.max(1, values.length - 1)) * (width - inset * 2),
    y: height - inset - (value / top) * (height - inset * 2),
  });
  const points = values.map((value, index) => at(value, index));
  const last = points.at(-1);

  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex ${className}`}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-stroke-strong"
        />
        {last !== undefined && <circle cx={last.x} cy={last.y} r="3" className="fill-accent" />}
      </svg>
    </span>
  );
}
