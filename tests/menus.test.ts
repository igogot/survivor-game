import { describe, expect, it } from 'vitest';
import markup from '../index.html?raw';
import { resultSubtitle } from '../src/ui/menus';

/**
 * The result screen is DOM, but the sentence it prints is not, so it is tested
 * here in plain Node — the same split `describeOffer` uses.
 */
describe('resultSubtitle', () => {
  it('offers advice when the run never reached a boss', () => {
    expect(resultSubtitle(0)).toContain('Try standing somewhere else');
  });

  it('counts one boss in the singular', () => {
    expect(resultSubtitle(1)).toBe('One boss down. The horde kept coming anyway.');
  });

  it('counts the rest in the plural', () => {
    expect(resultSubtitle(2)).toBe('2 bosses down. The horde kept coming anyway.');
    expect(resultSubtitle(7)).toContain('7 bosses down');
  });

  it('never claims the run was won', () => {
    for (const felled of [0, 1, 2, 5]) {
      expect(resultSubtitle(felled).toLowerCase()).not.toContain('survived');
    }
  });
});

/**
 * `requireElement` throws when an id is missing, and every UI class calls it in
 * a field initialiser — so a forgotten `<div>` is not a wrong pixel, it is a
 * blank page at startup. Nothing else in the suite touches the DOM, which is
 * exactly why this one reads both sides as text.
 *
 * Vite's own `?raw` and `import.meta.glob` rather than `node:fs`, so the test
 * needs no Node types in a tsconfig that deliberately has none.
 */
describe('markup the UI requires', () => {
  const sources = import.meta.glob<string>('../src/ui/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  });

  const required = Object.values(sources).flatMap((source) =>
    [...source.matchAll(/requireElement\('([^']+)'\)/g)].map((match) => match[1]),
  );

  it('finds ids to check in the first place', () => {
    expect(required.length).toBeGreaterThan(10);
    expect(required).toContain('result-bosses');
    expect(required).toContain('stat-bosses');
  });

  it('has every element the UI asks for', () => {
    for (const id of required) {
      expect(markup, `index.html is missing id="${id}"`).toContain(`id="${id}"`);
    }
  });
});
