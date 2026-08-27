import { formatTime, requireElement } from './hud';
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

      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';

      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(index + 1);

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = offer.name;

      const description = document.createElement('div');
      description.className = 'desc';
      description.textContent = offer.description;

      const stackLine = document.createElement('div');
      stackLine.className = 'stacks';
      stackLine.textContent = `${taken + 1} / ${offer.maxStacks}`;

      card.append(key, name, description, stackLine);
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
 * Keyboard only, on purpose: the run must not resume from a stray click on a
 * button the player did not mean to hit.
 */
export class PauseScreen {
  private readonly root = requireElement('pause');

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

/** End-of-run screen, shown on death and on beating the boss. */
export class ResultScreen {
  private readonly root = requireElement('result');
  private readonly title = requireElement('result-title');
  private readonly subtitle = requireElement('result-sub');
  private readonly time = requireElement('result-time');
  private readonly kills = requireElement('result-kills');
  private readonly level = requireElement('result-level');

  show(world: World): void {
    const won = world.phase === 'won';
    this.title.textContent = won ? 'Survived' : 'You Died';
    this.subtitle.textContent = won
      ? 'The horde is broken.'
      : 'The horde does not stop. Try standing somewhere else.';

    this.time.textContent = formatTime(world.time);
    this.kills.textContent = String(world.kills);
    this.level.textContent = String(world.player.level);

    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
