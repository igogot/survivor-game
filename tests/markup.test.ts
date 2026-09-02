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
   * Every panel on this page depends on one rule to stay out of the way.
   *
   * `hidden` carries no weight of its own. Its whole effect is the browser's
   * `[hidden] { display: none }`, and a stylesheet outranks a browser whatever
   * the specificity — so one author rule setting `display` on a hidden element
   * switches the attribute off for it, silently, with nothing to see but a
   * panel that will not go away.
   *
   * That is not a hypothetical. `.step { display: contents }` did it to the
   * whole opening screen: five panels meant to be shown one at a time were all
   * on the page together, and the code that swapped between them had never once
   * been visible. It was worked around eight separate times in this file before
   * anybody traced it, each time by writing `#that-one[hidden] { display: none }`
   * for one more element.
   *
   * So the rule is global and `!important`, and this is the test that says so.
   */
  it('keeps the rule that makes hidden mean hidden', () => {
    expect(stylesheet()).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  /**
   * And nothing outranks it.
   *
   * The rule above can only be beaten by another `!important`, so that is the
   * one thing to watch for. Anything else setting `display` is now harmless,
   * which is the entire point of writing it this way.
   */
  it('lets nothing outrank that rule', () => {
    const shouting = [...stylesheet().matchAll(/([^{}]+)\{[^}]*display:[^;}]*!important/g)]
      .map((match) => match[1].trim())
      .filter((selector) => !selector.includes('[hidden]'));

    expect(shouting, `${shouting.join(', ')} can override [hidden]`).toEqual([]);
  });

  /**
   * The opening screen is a flow, and the markup has to agree.
   *
   * Every step but the first carries `hidden` in the source, so the page is
   * already showing one panel before a line of script runs. Getting this wrong
   * is not a wrong pixel: it is every panel of the flow at once for as long as
   * it takes the bundle to load.
   */
  it('opens the start screen on one step', () => {
    const steps = [...html.matchAll(/<div class="step" id="(step-[a-z]+)"([^>]*)>/g)];

    expect(steps.map((step) => step[1])).toEqual([
      'step-mode',
      'step-weapons',
      'step-party',
      'step-join',
      'step-room',
    ]);

    for (const [, id, attributes] of steps) {
      const shown = id === 'step-mode';
      expect(attributes.includes('hidden'), `${id} should start ${shown ? 'shown' : 'hidden'}`).toBe(
        !shown,
      );
    }
  });

  /**
   * And none of them sits inside a step.
   *
   * The board, the account and the briefing hang below the steps rather than
   * inside one. Inside `step-mode` they would be part of the question; inside
   * `step-weapons` they would be unreachable from the multiplayer half of the
   * screen.
   *
   * What differs between the three is *when* they appear, and that is
   * `StartScreen.step`'s business rather than the markup's. The board is shown
   * on every step including the first, because looking at records asks nothing
   * of the player — somebody opening the game to see whether their record still
   * stood had to answer a mode question first, which is a toll on a look. The
   * account and the briefing still wait, so the opening screen keeps having one
   * question on it.
   */
  it('keeps the board, the account and the briefing out of the steps', () => {
    const mode = /<div class="step" id="step-mode">([\s\S]*?)<div class="step" id="step-weapons"/.exec(
      html,
    );
    if (mode === null) throw new Error('index.html has no step-mode');

    for (const id of ['start-records', 'start-account', 'help-start']) {
      expect(mode[1], `${id} is inside the mode choice`).not.toContain(id);
    }

    // Below the steps, and no longer shut: the board is reachable from the
    // first screen, and `StartScreen` hides the account by itself.
    expect(html).toMatch(/<div class="actions" id="start-actions">/);
    expect(html).toMatch(/<div class="help" id="help-start" hidden><\/div>/);
  });
});

describe('the ways out of a run', () => {
  /**
   * A run can be left from two screens and there has to be a door on each.
   * Restarting already landed on the mode choice, but it is not labelled as a
   * way back, and from a party it left the connection standing.
   */
  it('offers the main menu from the pause screen and the result screen', () => {
    expect(html).toContain('id="pause-menu"');
    expect(html).toContain('id="result-menu"');
  });

  /**
   * Every screen a player can be looking at while not playing.
   *
   * The board asks nothing and costs nothing, so there is no screen it earns
   * its way onto — the question is only which ones it was missing from. It was
   * missing from all three at some point: the opening screen until a mode was
   * chosen, and the pause screen entirely, which is exactly when somebody
   * wonders whether the run they are in the middle of is beating anything.
   */
  it('offers the board from every screen a player stops on', () => {
    for (const id of ['start-records', 'pause-records', 'result-records']) {
      expect(html, `${id} is missing`).toContain(`id="${id}"`);
    }
  });

  /**
   * The pause one is filled by `PauseScreen`, because its label changes when
   * it is armed and a stamped one would put the calm word back. The result one
   * never arms, so it carries its text in the markup like any other button.
   */
  it('leaves the pause button empty and stamps the result one', () => {
    expect(html).toMatch(/id="pause-menu"[^>]*><\/button>/);
    expect(html).toMatch(/id="result-menu"[^>]*data-i18n="menu.toMenu"/);
  });
});
