import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';

/**
 * The stylesheet, checked for the one mistake that ships silently.
 *
 * Nothing else looks at it. `tsc` does not read the `<style>` block, the tests
 * render no DOM, and the build copies `index.html` through untouched — so a
 * broken rule reaches production without a single red light on the way.
 *
 * It happened. Two branches added CSS at the same point in the file, the merge
 * spliced both insertions together, and the `}` closing one of them was
 * absorbed. Everything after that brace became part of a rule that never
 * closed, so the browser dropped the entire second half of the stylesheet: the
 * cards, the overlays, the whole layout. Both branches were correct on their
 * own, CI was green, and the game went out looking like a plain HTML document.
 *
 * A brace count would have caught it in a millisecond, so now one does.
 */

/** The stylesheet with comments removed, so braces inside them do not count. */
function stylesheet(): string {
  const block = /<style>([\s\S]*?)<\/style>/.exec(html);
  if (block === null) throw new Error('index.html has no <style> block');
  return block[1].replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the stylesheet', () => {
  it('is there at all', () => {
    expect(stylesheet().length).toBeGreaterThan(1000);
  });

  /**
   * The check that matters. An unclosed rule does not fail loudly — the parser
   * swallows every rule after it, and the page renders as though the styles
   * below that point were never written.
   */
  it('closes every rule it opens', () => {
    const css = stylesheet();
    const opened = (css.match(/\{/g) ?? []).length;
    const closed = (css.match(/\}/g) ?? []).length;

    expect(
      opened,
      `${opened} "{" against ${closed} "}" — an unclosed rule hides every rule after it`,
    ).toBe(closed);
  });

  /**
   * Where, not just whether. A count alone says a brace is missing somewhere in
   * eight hundred lines; this says which rule swallowed the rest of the file.
   */
  it('never leaves a rule open past the end', () => {
    const css = stylesheet();
    const lines = css.split('\n');

    let depth = 0;
    let openedAt = 0;
    for (const [index, line] of lines.entries()) {
      for (const character of line) {
        if (character === '{') {
          if (depth === 0) openedAt = index + 1;
          depth++;
        } else if (character === '}') {
          depth--;
        }
      }
      // A closing brace with nothing open means the file went wrong earlier
      // than this, and the count above will already have said so.
      expect(depth, `an extra "}" near line ${index + 1} of the stylesheet`).toBeGreaterThanOrEqual(
        0,
      );
    }

    expect(depth, `a rule opened near line ${openedAt} of the stylesheet is never closed`).toBe(0);
  });

  /**
   * Every overlay depends on this one rule to stay out of the way. Without it
   * they all render at once, stacked down the page — which is exactly what the
   * broken stylesheet looked like.
   */
  it('keeps the rule that hides an overlay', () => {
    expect(stylesheet()).toMatch(/\.overlay\[hidden\]\s*\{[^}]*display:\s*none/);
  });
});
