import { formatTime, requireElement } from './hud';
import { describeOffer, describeSpoil } from './offers';
import { renderHelp } from './help';
import { cssColor, starterChoices } from './starters';
import type { SpritePainter, StarterChoice } from './starters';
import type { SpoilDef } from '../data/spoils';
import type { UpgradeDef } from '../data/upgrades';
import type { World } from '../world/world';

/** Side of the figure painted onto a card, matching its atlas frame. */
const STARTER_ART_SIZE = 64;

/**
 * The opening screen: choose a weapon, and read the rules while you do.
 *
 * It carries the briefing because the game teaches nothing while it is
 * running — weapons fire themselves, the level-up menu appears without warning
 * and the boss arrives ten minutes in. Hanging the rules off the one screen a
 * player has a reason to look at means they are read by people who would never
 * open a manual.
 *
 * The choice is the screen's real job. It is the only decision in the game
 * made before the horde arrives, it sets which figure the player is for the
 * whole run, and it is what the level-up cards then build on.
 *
 * The run is paused behind it rather than merely covered — a briefing that
 * costs health is one nobody reads twice.
 */
export class StartScreen {
  private readonly root = requireElement('start');
  private readonly cards = requireElement('start-weapons');
  private readonly keys = requireElement('start-keys');

  /**
   * Built once, not on every show.
   *
   * The weapons cannot change within a session, and rebuilding would throw
   * away the canvases their figures were painted into — which is real work,
   * since each one may have come out of the artwork sheet.
   */
  constructor(onStart: (weaponId: string) => void, paint: SpritePainter) {
    const choices = starterChoices();

    for (const choice of choices) {
      this.cards.append(starterCard(choice, onStart, paint));
    }

    this.keys.replaceChildren(...keyHint(choices));
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

/**
 * One weapon's card: who you become, what it is called, what it does.
 *
 * The figure is painted rather than described because it is the part of the
 * choice that cannot be put into a sentence — the player will be looking at
 * that silhouette for the rest of the run.
 */
function starterCard(
  choice: StarterChoice,
  onStart: (weaponId: string) => void,
  paint: SpritePainter,
): HTMLElement {
  const card = document.createElement('button');
  card.className = 'starter';
  card.type = 'button';
  // The weapon's own colour, so the card, the projectiles and the level-up
  // cards for it all agree without any of them holding a second palette.
  card.style.setProperty('--weapon', cssColor(choice.color));

  const top = document.createElement('span');
  top.className = 'starter-top';

  const key = document.createElement('span');
  key.className = 'key';
  key.textContent = choice.key;

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = choice.name;

  top.append(key, name);

  const art = document.createElement('canvas');
  art.className = 'starter-art';
  // Painted at the frame's own size and scaled down by CSS: the artwork is
  // 16px pixel art, and asking a canvas to do the scaling would blur it.
  art.width = STARTER_ART_SIZE;
  art.height = STARTER_ART_SIZE;
  paint(choice.sprite, art);

  const detail = document.createElement('span');
  detail.className = 'desc';
  detail.textContent = choice.detail;

  card.append(top, art, detail);
  card.addEventListener('click', () => onStart(choice.id));
  return card;
}

/**
 * The line of digits under the cards.
 *
 * Built from the choices rather than typed into the markup, for the reason the
 * help panel gives about its own numbers: a hint written by hand goes stale
 * silently and confidently. This one said "press 1 2 3" while there were five
 * weapons on the screen.
 */
function keyHint(choices: readonly StarterChoice[]): readonly Node[] {
  const nodes: Node[] = [document.createTextNode('press ')];

  for (const choice of choices) {
    nodes.push(keycap(choice.key), document.createTextNode(' '));
  }

  nodes.push(document.createTextNode('· '), keycap('Space'));
  nodes.push(document.createTextNode(' takes the first'));
  return nodes;
}

function keycap(label: string): HTMLElement {
  const key = document.createElement('kbd');
  key.textContent = label;
  return key;
}

/**
 * Fills every copy of the rules on the page.
 *
 * Three panels show the same text, so it is rendered from one source into all
 * of them at boot instead of being written three times in the markup. Missing
 * containers are skipped rather than thrown on: the panel is an aid, and a page
 * that lost one should still be playable.
 */
export function mountHelp(ids: readonly string[]): void {
  for (const id of ids) {
    const host = document.getElementById(id);
    if (host !== null) renderHelp(host);
  }
}

/** The level-up screen. Rebuilt on each show — it appears a few dozen times a run. */
export class UpgradeMenu {
  private readonly root = requireElement('levelup');
  private readonly cards = requireElement('upgrade-cards');

  constructor(private readonly onPick: (id: string) => void) {}

  show(offers: readonly UpgradeDef[], stacks: ReadonlyMap<string, number>): void {
    this.cards.replaceChildren();

    offers.forEach((offer, index) => {
      const taken = stacks.get(offer.id) ?? 0;
      const label = describeOffer(offer, taken);

      const card = document.createElement('button');
      card.className = `card card--${label.kind}`;
      card.type = 'button';

      const top = document.createElement('span');
      top.className = 'card-top';

      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(index + 1);

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = label.badge;

      top.append(key, badge);

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = offer.name;

      const description = document.createElement('div');
      description.className = 'desc';
      description.textContent = offer.description;

      const stackLine = document.createElement('div');
      stackLine.className = label.isNew ? 'stacks stacks--new' : 'stacks';
      stackLine.textContent = label.progress;

      card.append(top, name, description, stackLine);
      card.addEventListener('click', () => this.onPick(offer.id));
      this.cards.append(card);
    });

    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

/**
 * The chest screen.
 *
 * Deliberately built out of the same cards as the level-up menu — same size,
 * same digits, same shape — because it is the same gesture and a second visual
 * language would be one more thing to learn mid-run. What differs is what the
 * cards say: a badge naming which of the three questions each one answers, and
 * a line saying it is spent on the spot.
 *
 * Rebuilt on each show like the level-up menu, and for the same reason: what
 * is inside is rolled when the chest is opened, so there is nothing to keep.
 */
export class ChestMenu {
  private readonly root = requireElement('chest');
  private readonly cards = requireElement('chest-cards');

  constructor(private readonly onTake: (id: string) => void) {}

  show(spoils: readonly SpoilDef[]): void {
    this.cards.replaceChildren();

    spoils.forEach((spoil, index) => {
      const label = describeSpoil(spoil);

      const card = document.createElement('button');
      card.className = 'card card--spoil';
      card.type = 'button';

      const top = document.createElement('span');
      top.className = 'card-top';

      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(index + 1);

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = label.badge;

      top.append(key, badge);

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = spoil.name;

      const description = document.createElement('div');
      description.className = 'desc';
      description.textContent = spoil.description;

      const note = document.createElement('div');
      note.className = 'stacks';
      note.textContent = label.note;

      card.append(top, name, description, note);
      card.addEventListener('click', () => this.onTake(spoil.id));
      this.cards.append(card);
    });

    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

/**
 * The freeze screen.
 *
 * Resuming is deliberately not "click anywhere": the run must not restart from
 * a stray tap on a screen the player put down. A phone has no Esc key, so it
 * gets one button that says what it does, and nothing else on the overlay
 * responds.
 */
export class PauseScreen {
  private readonly root = requireElement('pause');
  private readonly resumeButton = requireElement('pause-resume');
  private readonly restartButton = requireElement('pause-restart');

  /** True once restart has been asked for and is waiting to be confirmed. */
  private armed = false;

  constructor(
    onResume: () => void,
    private readonly onRestart: () => void,
  ) {
    this.resumeButton.addEventListener('click', onResume);
    this.restartButton.addEventListener('click', () => this.requestRestart());
  }

  /**
   * Restart takes two presses: the first arms the button, the second throws the
   * run away.
   *
   * A ten-minute run is a lot to lose to a stray click on a menu the player
   * opened to do something else, and there is no undo. The button says what the
   * second press will do rather than opening a dialog, so the pause screen stays
   * one panel.
   */
  requestRestart(): void {
    if (!this.armed) {
      this.armed = true;
      this.restartButton.textContent = 'Sure? The run is lost';
      this.restartButton.classList.add('action--armed');
      return;
    }

    this.disarm();
    this.onRestart();
  }

  show(): void {
    // Only on the way in, so a repeated sync cannot silently disarm the button
    // between the player arming it and pressing again.
    if (this.root.hidden) this.disarm();
    this.root.hidden = false;
  }

  hide(): void {
    this.disarm();
    this.root.hidden = true;
  }

  private disarm(): void {
    this.armed = false;
    this.restartButton.textContent = 'Restart run';
    this.restartButton.classList.remove('action--armed');
  }
}

/**
 * End-of-run screen.
 *
 * There is one ending now, so the screen has one title. What varies is the line
 * under it: a run that felled a boss ended differently from one that never got
 * there, and the number itself is on the stat row either way.
 */
export class ResultScreen {
  private readonly root = requireElement('result');
  private readonly againButton = requireElement('result-again');
  private readonly title = requireElement('result-title');
  private readonly subtitle = requireElement('result-sub');
  private readonly time = requireElement('result-time');
  private readonly kills = requireElement('result-kills');
  private readonly level = requireElement('result-level');
  private readonly bosses = requireElement('result-bosses');

  constructor(onRestart: () => void) {
    this.againButton.addEventListener('click', onRestart);
  }

  show(world: World): void {
    this.title.textContent = 'You Died';
    this.subtitle.textContent = resultSubtitle(world.bossesKilled);

    this.time.textContent = formatTime(world.time);
    this.kills.textContent = String(world.kills);
    this.level.textContent = String(world.level);
    this.bosses.textContent = String(world.bossesKilled);

    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

/**
 * The one line that still reports how the run went.
 *
 * Exported and free of the DOM so the wording is testable in plain Node, the
 * same split `describeOffer` uses.
 */
export function resultSubtitle(bossesKilled: number): string {
  if (bossesKilled === 0) return 'The horde does not stop. Try standing somewhere else.';
  if (bossesKilled === 1) return 'One boss down. The horde kept coming anyway.';
  return `${bossesKilled} bosses down. The horde kept coming anyway.`;
}
