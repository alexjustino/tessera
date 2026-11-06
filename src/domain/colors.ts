/**
 * The colours a section or a list can wear, to tell them apart at a glance.
 *
 * A short, fixed list with names, because a person picks a colour to mean
 * something, and nine named ones are easier to keep meaning the same thing than a
 * picker with millions. Each is drawn as a mark beside a name, never as the only cue,
 * and each is at least 3:1 on a card in both themes (`tokens.test.ts`).
 *
 * Pure: no I/O, no React, no host.
 */

export const COLORS = [
  { id: 'red', label: 'Red' },
  { id: 'orange', label: 'Orange' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'teal', label: 'Teal' },
  { id: 'blue', label: 'Blue' },
  { id: 'purple', label: 'Purple' },
  { id: 'pink', label: 'Pink' },
  { id: 'gray', label: 'Gray' },
] as const;

export type ColorId = (typeof COLORS)[number]['id'];

export function isColor(value: unknown): value is ColorId {
  return COLORS.some((color) => color.id === value);
}

export function colorLabel(color: ColorId | null): string {
  return COLORS.find((candidate) => candidate.id === color)?.label ?? 'No colour';
}

/** The class that paints a mark in this colour. Written out whole so the build keeps it. */
export const SWATCH: Record<ColorId, string> = {
  red: 'bg-tag-red',
  orange: 'bg-tag-orange',
  yellow: 'bg-tag-yellow',
  green: 'bg-tag-green',
  teal: 'bg-tag-teal',
  blue: 'bg-tag-blue',
  purple: 'bg-tag-purple',
  pink: 'bg-tag-pink',
  gray: 'bg-tag-gray',
};

/** The colour after the last one used, so a new section is told apart by default. */
export function nextColor(used: readonly (string | null)[]): ColorId {
  const counts = new Map<ColorId, number>(COLORS.map((color) => [color.id, 0]));
  for (const color of used) if (isColor(color)) counts.set(color, (counts.get(color) ?? 0) + 1);
  const fewest = Math.min(...counts.values());
  return COLORS.find((color) => counts.get(color.id) === fewest)?.id ?? 'blue';
}
