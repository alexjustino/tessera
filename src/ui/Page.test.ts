import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const FEATURES = path.resolve(import.meta.dirname, '..', 'features');

/** Every destination the rail opens. Notes keeps a reading measure of its own. */
const DESTINATIONS = [
  'tasks/TasksPage.tsx',
  'mosaic/MosaicPage.tsx',
  'goals/GoalsPage.tsx',
  'review/ReviewPage.tsx',
  'reports/ReportsPage.tsx',
  'settings/SettingsPage.tsx',
  'foundation/FoundationPage.tsx',
  'about/AboutPage.tsx',
];

describe('a destination fills the window', () => {
  it('names real files', () => {
    const folders = readdirSync(FEATURES);
    for (const file of DESTINATIONS) {
      expect(folders).toContain(file.split('/')[0]);
    }
  });

  it.each(DESTINATIONS)('%s uses the shared frame and sets no width of its own', (file) => {
    const source = readFileSync(path.join(FEATURES, file), 'utf8');
    expect(source).toContain("from '@/ui/Page'");
    // A cap on the outermost column is what left a maximised window half empty.
    expect(source).not.toMatch(/mx-auto[^"']*max-w-/);
  });
});
