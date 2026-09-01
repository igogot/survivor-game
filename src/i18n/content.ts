/**
 * Text that belongs to a piece of game data.
 *
 * A weapon's name, an upgrade's description and the line the rules print about
 * a weapon are all keyed by the id the simulation already uses, so there is no
 * second name to keep in step. English lives on the definitions themselves —
 * `src/data/weapons.ts` and friends stay readable, and the simulation keeps
 * knowing nothing about languages. Only the Russian is here.
 *
 * Completeness is a test rather than a type: ids are plain strings on the
 * definitions, so `tests/i18n.test.ts` walks the real tables and fails on a
 * card that reaches the pool without a translation — and on a translation left
 * behind by a card that was deleted.
 */

export interface ContentText {
  readonly name: string;
  readonly description: string;
}

/** Weapon names, by `WeaponDef.id`. */
export const RU_WEAPONS: Readonly<Record<string, string>> = {
  bolt: 'Автоболт',
  orbit: 'Клинки на орбите',
  nova: 'Ударная волна',
  spear: 'Копьё-выпад',
  harpoon: 'Осадный гарпун',
  ember: 'Огненный след',
};

/**
 * What a weapon is for, in one line, by `WeaponDef.id`.
 *
 * The English half used to live in `src/ui/help.ts`. It moved here so that the
 * two languages of the same sentence sit next to each other: a line rewritten
 * in one and not the other is the failure this file exists to make visible.
 */
export const EN_ROLES: Readonly<Record<string, string>> = {
  bolt: 'Fires at the nearest enemy in range, and at one more for every extra shot it has bought. The only weapon that reaches across the screen, which makes it the forgiving one to open with.',
  orbit: 'Blades circle you and cut what they touch. They guard the ground you are standing on, not the ground ahead.',
  nova: 'A burst of damage around you every few seconds. It does not care how many enemies are caught in it.',
  spear: 'Lunges at the nearest enemy and hits everything standing behind them. The way through a wall rather than around it.',
  harpoon: 'Spikes the biggest thing in range, not the closest. Slow to reload and wasted on a grunt, which is the point: it is what you bring to a boss.',
  ember: 'Leaves burning ground wherever you walk, and everything standing in it burns. The only weapon that pays you for running, and the only one that stops while you stand still.',
};

export const RU_ROLES: Readonly<Record<string, string>> = {
  bolt: 'Стреляет в ближайшего врага в радиусе, и ещё по одному на каждый докупленный выстрел. Единственное оружие, достающее через весь экран, — потому с ним и проще всего начинать.',
  orbit: 'Клинки кружат вокруг тебя и режут то, чего касаются. Они стерегут землю, на которой ты стоишь, а не ту, что впереди.',
  nova: 'Взрыв урона вокруг тебя раз в несколько секунд. Ему всё равно, сколько врагов накрыло.',
  spear: 'Выпад в ближайшего врага, задевающий всех, кто стоит за ним. Путь сквозь стену, а не в обход неё.',
  harpoon: 'Бьёт в самую крупную цель в радиусе, а не в ближайшую. Долго перезаряжается и пропадает зря на мелочи — в этом и смысл: это то, что берут на босса.',
  ember: 'Оставляет горящую землю везде, где ты прошёл, и всё, что в ней стоит, горит. Единственное оружие, которое платит за бег, и единственное, которое молчит, пока ты стоишь.',
};

/** Level-up cards, by `UpgradeDef.id`. */
export const RU_UPGRADES: Readonly<Record<string, ContentText>> = {
  orbit: {
    name: 'Клинки на орбите',
    description: 'Кольцо стражи на длину руки, режущее всё, что до тебя дотянулось. +1 клинок за уровень',
  },
  nova: {
    name: 'Ударная волна',
    description: 'Взрыв урона вокруг тебя раз в несколько секунд. +урон и радиус',
  },
  damage: { name: 'Точильный камень', description: '+25% урона' },
  haste: { name: 'Быстрые руки', description: '+20% скорости атаки' },
  boots: { name: 'Лёгкие сапоги', description: '+12% скорости бега' },
  multishot: {
    name: 'Раздвоенный прицел',
    description: 'Автоболт бьёт ещё по одному врагу за раз',
  },
  pierce: { name: 'Пробивающее остриё', description: 'Автоболт пробивает ещё одного врага' },
  'orbit-reach': {
    name: 'Длинный размах',
    description: 'Клинки на орбите растут, утолщая защиту, а не отодвигая её от тебя',
  },
  'nova-blast': { name: 'Широкий разлёт', description: 'Ударная волна накрывает больше земли' },
  magnet: { name: 'Магнитное ядро', description: '+40% радиуса подбора' },
  vitality: { name: 'Живучесть', description: '+25 к максимуму здоровья, лечит при взятии' },
  'orbit-spin': {
    name: 'Вихревая кромка',
    description: 'Клинки на орбите вращаются быстрее и режут чаще',
  },
  'nova-cadence': { name: 'Раскаты грома', description: 'Ударная волна бьёт чаще' },
  spear: {
    name: 'Копьё-выпад',
    description: 'Выпад в ближайшего врага, нанизывающий всех, кто за ним. +длина и урон за уровень',
  },
  'spear-haft': { name: 'Длинное древко', description: 'Копьё-выпад достаёт дальше и метёт шире' },
  'spear-cadence': { name: 'Быстрый укол', description: 'Копьё-выпад колет чаще' },
  harpoon: {
    name: 'Осадный гарпун',
    description: 'Одно тяжёлое остриё в самую крупную цель в радиусе. +урон за уровень',
  },
  'harpoon-winch': { name: 'Лебёдка', description: 'Осадный гарпун перезаряжается быстрее' },
  ember: {
    name: 'Огненный след',
    description: 'Горящая земля позади тебя, куда бы ты ни шёл. +урон и ширина за уровень',
  },
  'ember-spread': { name: 'Пожар', description: 'Огненный след выжигает полосу шире' },
  'ember-heat': { name: 'Белый жар', description: 'Огненный след занимается чаще' },
  grindstone: { name: 'Точильный круг', description: '+10% урона' },
  reflexes: { name: 'Мышечная память', description: '+8% скорости атаки' },
  'scar-tissue': { name: 'Рубцовая ткань', description: '+20 к максимуму здоровья, лечит при взятии' },
  'bolt-heft': { name: 'Утяжелённые болты', description: '+15% урона Автоболта' },
  'orbit-edge': { name: 'Острее кромка', description: '+15% урона Клинков на орбите' },
  'nova-depth': { name: 'Глубже гром', description: '+15% урона Ударной волны' },
  'spear-point': { name: 'Заточенное остриё', description: '+15% урона Копья-выпада' },
  'harpoon-weight': { name: 'Тяжелее наконечник', description: '+15% урона Осадного гарпуна' },
  'ember-fuel': { name: 'Жирнее топливо', description: '+15% урона Огненного следа' },
};

/** Chest spoils, by `SpoilDef.id`. */
export const RU_SPOILS: Readonly<Record<string, ContentText>> = {
  mend: {
    name: 'Полевая перевязка',
    description: 'Возвращает половину здоровья. Всё, что сверх полного, пропадает.',
  },
  purge: {
    name: 'Подчистую',
    description: 'Убивает всю орду там, где она стоит, и кристаллы падают со всех. Босса не берёт.',
  },
  harvest: {
    name: 'Мелочь по карманам',
    description: 'Все кристаллы, мимо которых ты прошёл, летят к тебе — даже из-за края экрана.',
  },
};
