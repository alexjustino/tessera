/**
 * The one wall-clock-to-instant conversion in the product.
 *
 * The `datetime-local` control has no concept of a zone: it shows and returns
 * wall-clock digits. Converting on both sides, here and nowhere else, is what
 * stops a due date drifting by the offset every time somebody opens the panel.
 *
 * Its own module rather than living in the editor, because it is data plumbing
 * and not a component — and keeping it in the component file breaks fast
 * refresh on the screen that uses it.
 */

/**
 * An instant, as the `datetime-local` control wants it.
 *
 * The control has no concept of a zone: it shows and returns wall-clock digits.
 * Converting on both sides, here, is what stops a due date drifting by the
 * offset every time somebody opens the panel.
 */
export function toLocalInput(instant: string | null): string {
  if (instant === null) return '';
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** What the control returned, back to an instant. */
export function fromLocalInput(value: string): string | null {
  if (value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
