import type { World } from '../world/world';

/** Rings start at a third of their size and grow out, which reads as a burst. */
const START_SCALE = 0.35;

/**
 * Advances cosmetic effects and recycles the expired ones.
 *
 * They are pooled like any other entity: a ten-minute run fires a few hundred
 * shockwaves, and the point of the pool is that none of them allocates.
 */
export function effectSystem(world: World, dt: number): void {
  const effects = world.effects;

  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];

    effect.pradius = effect.radius;
    effect.life -= dt;

    if (effect.life <= 0) {
      effects[i] = effects[effects.length - 1];
      effects.pop();
      world.effectPool.release(effect);
      continue;
    }

    const t = 1 - effect.life / effect.maxLife;
    effect.radius = effect.maxRadius * (START_SCALE + (1 - START_SCALE) * t);
  }
}

export function spawnEffect(
  world: World,
  x: number,
  y: number,
  maxRadius: number,
  life: number,
  color: number,
): void {
  const effect = world.effectPool.obtain();

  effect.x = x;
  effect.y = y;
  effect.maxRadius = maxRadius;
  effect.radius = maxRadius * START_SCALE;
  effect.pradius = effect.radius;
  effect.life = life;
  effect.maxLife = life;
  effect.color = color;

  world.effects.push(effect);
}
