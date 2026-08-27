import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../src/data/upgrades';
import { describeOffer } from '../src/ui/offers';
import type { UpgradeDef } from '../src/data/upgrades';

function upgrade(id: string): UpgradeDef {
  const found = UPGRADES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no upgrade '${id}' in UPGRADES`);
  return found;
}

const weapon = upgrade('orbit');
const stat = upgrade('damage');

describe('describeOffer', () => {
  it('badges a weapon modifier apart from both', () => {
    const mod = UPGRADES.find((candidate) => candidate.kind === 'weaponMod');
    if (mod === undefined) throw new Error('no weaponMod in UPGRADES');

    const label = describeOffer(mod, 0);

    expect(label.badge).toBe('MOD');
    // Grouped with weapons by colour, separated from them by the word.
    expect(label.kind).toBe('weapon');
    expect(describeOffer(weapon, 0).badge).toBe('WEAPON');
  });

  it('badges a weapon apart from a stat upgrade', () => {
    expect(describeOffer(weapon, 0).kind).toBe('weapon');
    expect(describeOffer(weapon, 0).badge).toBe('WEAPON');

    expect(describeOffer(stat, 0).kind).toBe('stat');
    expect(describeOffer(stat, 0).badge).toBe('UPGRADE');
  });

  it('calls the first take NEW rather than 1 / max', () => {
    const label = describeOffer(weapon, 0);

    expect(label.isNew).toBe(true);
    expect(label.progress).toBe('NEW');
    expect(label.progress).not.toContain('/');
  });

  it('shows later takes as the level they move to', () => {
    const label = describeOffer(weapon, 1);

    expect(label.isNew).toBe(false);
    expect(label.progress).toBe('Lv 1 → 2');
  });

  it('flags the take that reaches the stack cap', () => {
    const last = describeOffer(weapon, weapon.maxStacks - 1);

    expect(last.isMax).toBe(true);
    expect(last.progress).toContain('MAX');
  });

  it('does not flag MAX while stacks remain', () => {
    const label = describeOffer(weapon, 0);

    expect(weapon.maxStacks).toBeGreaterThan(1);
    expect(label.isMax).toBe(false);
    expect(label.progress).not.toContain('MAX');
  });

  it('marks a single-stack offer as both new and maxed', () => {
    const once: UpgradeDef = {
      kind: 'weapon',
      id: 'once',
      weaponId: 'once',
      name: 'One Shot',
      description: 'Taken once and never again.',
      maxStacks: 1,
    };

    const label = describeOffer(once, 0);

    expect(label.isNew).toBe(true);
    expect(label.isMax).toBe(true);
    expect(label.progress).toBe('NEW · MAX');
  });

  it('describes every shipped upgrade without throwing', () => {
    for (const offer of UPGRADES) {
      for (let taken = 0; taken < offer.maxStacks; taken++) {
        const label = describeOffer(offer, taken);
        expect(label.progress).not.toBe('');
        expect(['weapon', 'stat']).toContain(label.kind);
      }
    }
  });
});
