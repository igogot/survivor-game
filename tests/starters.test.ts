import { describe, expect, it } from 'vitest';
import { STARTER_WEAPON_ID, WEAPONS, starterWeapon } from '../src/data/weapons';
import { SPRITE_SPECS } from '../src/render/atlas';
import { OFFERS_PER_LEVEL } from '../src/systems/progression';
import { cssColor, starterChoices } from '../src/ui/starters';
import { helpSections } from '../src/ui/help';
import { World } from '../src/world/world';

const CHOICES = starterChoices();

describe('starterChoices', () => {
  it('offers every weapon, in the order the data lists them', () => {
    expect(CHOICES.map((choice) => choice.id)).toEqual(WEAPONS.map((def) => def.id));
  });

  /** A card nobody can read is a choice made blind. */
  it('names and describes every choice', () => {
    for (const choice of CHOICES) {
      expect(choice.name, choice.id).not.toBe('');
      expect(choice.detail, choice.id).not.toBe('');
    }
  });

  /**
   * The description is the panel's own sentence about the weapon. Two wordings
   * for one weapon is how a player learns to trust neither.
   */
  it('says the same thing about a weapon as the rules panel does', () => {
    const weaponSection = helpSections().find((section) => section.title === 'The weapons');
    const rules = new Map(
      (weaponSection?.rows ?? []).map((row) => [row.kind === 'note' ? row.term : '', row.detail]),
    );

    for (const choice of CHOICES) {
      expect(rules.get(choice.name), choice.id).toBe(choice.detail);
    }
  });

  /**
   * The whole point of the choice: the run looks different depending on what
   * opened it. Two weapons sharing a figure would make the pick invisible.
   */
  it('turns the player into a different figure for each weapon', () => {
    const sprites = CHOICES.map((choice) => choice.sprite);

    expect(new Set(sprites).size).toBe(CHOICES.length);
  });

  it('only names figures the atlas actually packs', () => {
    const packed = new Set(SPRITE_SPECS.map((spec) => spec.name));

    for (const choice of CHOICES) {
      expect(packed.has(choice.sprite), `${choice.id} wants ${choice.sprite}`).toBe(true);
    }
  });

  /** Same gesture as the level-up screen, so the keys have to agree with it. */
  it('numbers the cards from one, within the digits the level-up screen uses', () => {
    expect(CHOICES.map((choice) => choice.key)).toEqual(
      CHOICES.map((_, index) => String(index + 1)),
    );
    expect(CHOICES.length).toBeLessThanOrEqual(OFFERS_PER_LEVEL);
  });
});

describe('cssColor', () => {
  it('writes a weapon colour the way CSS wants it', () => {
    expect(cssColor(0x7fe7ff)).toBe('#7fe7ff');
  });

  it('keeps the leading zeroes a dark colour needs', () => {
    expect(cssColor(0x0000ff)).toBe('#0000ff');
    expect(cssColor(0)).toBe('#000000');
  });
});

describe('starterWeapon', () => {
  it('answers with the weapon that was asked for', () => {
    for (const def of WEAPONS) {
      expect(starterWeapon(def.id)).toBe(def);
    }
  });

  /**
   * A saved link, a typo, a weapon deleted between releases. Any of them would
   * otherwise open a run with no weapon at all, which is unplayable and reads
   * as a broken game rather than a bad link.
   */
  it('falls back to the starter for anything it does not recognise', () => {
    for (const id of ['', 'nope', null, undefined]) {
      expect(starterWeapon(id).id).toBe(STARTER_WEAPON_ID);
    }
  });
});

describe('a run opened with a chosen weapon', () => {
  it('grants that weapon and nothing else', () => {
    for (const def of WEAPONS) {
      const world = new World(1, def.id);

      expect(world.weapons.map((state) => state.defId)).toEqual([def.id]);
      expect(world.starterId).toBe(def.id);
    }
  });

  it('makes the player the figure that weapon comes with', () => {
    for (const def of WEAPONS) {
      expect(new World(1, def.id).player.sprite).toBe(def.playerSprite);
    }
  });

  it('opens with the starter when nobody chose', () => {
    const world = new World(1);

    expect(world.starterId).toBe(STARTER_WEAPON_ID);
    expect(world.weapons).toHaveLength(1);
  });

  it('arms the player even when handed an id that names nothing', () => {
    const world = new World(1, 'not-a-weapon');

    expect(world.starterId).toBe(STARTER_WEAPON_ID);
    expect(world.weapons.map((state) => state.defId)).toEqual([STARTER_WEAPON_ID]);
  });

  /** The seed is what makes a run reproducible; the weapon must not disturb it. */
  it('leaves the seed alone', () => {
    expect(new World(42, 'nova').seed).toBe(42);
  });
});
