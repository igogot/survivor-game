import { formatTime, requireElement } from './hud';
import { describeOffer } from './offers';
import type { UpgradeDef } from '../data/upgrades';
import type { World } from '../world/world';

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
    this.level.textContent = String(world.player.level);
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
