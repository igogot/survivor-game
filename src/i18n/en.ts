/**
 * Every line of interface text, in English.
 *
 * This table is the source of truth for what strings exist: `StringId` is its
 * own key set, so `ru.ts` is a `Record<StringId, string>` and the compiler
 * refuses a build with a line left untranslated. Adding a string here is what
 * creates the obligation to translate it.
 *
 * Text that belongs to a piece of game data — a weapon's name, an upgrade's
 * description — is not here. That lives in `content.ts`, keyed by the same id
 * the simulation uses, because those strings already have a name and inventing
 * a second one for them is how the two drift apart.
 *
 * `{braces}` mark a hole the caller fills: a number, a formatted clock, or a
 * keycap. See `t()` and `textNodes()`.
 */
export const EN = {
  // The HUD, which is read at a glance and never in a sentence.
  'hud.level': 'LV',
  'hud.kills': 'kills',
  'hud.bosses': 'bosses',
  'hud.enemies': 'enemies',
  'hud.pool': 'pool',
  'hud.byline': 'by igogot',
  'hud.bossName': "THE HORDE'S END",
  'hud.bossWarning': 'BOSS INCOMING',
  'hud.pauseLabel': 'Pause',

  'levelup.title': 'Level Up',
  'levelup.sub': 'Pick one — press {keys} or click',

  'chest.title': 'A Chest',
  'chest.sub': 'One of the three, used the moment you take it',

  'start.title': 'Survivor',
  'start.sub': 'One life, no finish line. Choose what you open with.',
  'start.press': 'press',
  'start.spaceTakes': 'takes the first',
  'start.touchHint': 'tap a weapon to begin',

  'pause.title': 'Paused',
  'pause.sub': '{esc} or {p} to resume · {r} to restart',
  'pause.resume': 'Resume',
  'pause.restart': 'Restart run',
  'pause.restartArmed': 'Sure? The run is lost',

  'result.title': 'Run Over',
  'result.died': 'You Died',
  'result.survived': 'survived',
  'result.kills': 'kills',
  'result.level': 'level',
  'result.bosses': 'bosses',
  'result.hint': 'Press {r} to run again',
  'result.again': 'Run again',
  'result.sub.none': 'The horde does not stop. Try standing somewhere else.',
  'result.sub.one': 'One boss down. The horde kept coming anyway.',
  'result.sub.many': '{count} bosses down. The horde kept coming anyway.',

  // The leaderboard. One row per name, and the only screen in the game that
  // shows anybody else.
  'board.title': 'Records',
  'board.sub': 'The hundred longest runs anybody has finished',
  'board.open': 'Records',
  'board.back': 'Back',
  'board.loading': 'Loading…',
  'board.empty': 'Nobody has set a record yet. Go first.',
  'board.unreachable': 'The leaderboard is unreachable — this run stays between us.',
  'board.offlineStale': 'Could not refresh — showing what was last loaded',
  'board.offlineEmpty': 'The board is unreachable from here',
  'board.nameLabel': 'Name for the leaderboard',
  'board.namePlaceholder': 'your name',
  'board.send': 'Put it on the board',
  'board.sending': 'Sending…',
  'board.placed': '{place} on the board.',
  'board.placedLate': 'Sent — but the board filled up first.',
  'board.qualifies': 'That is {place} place. Put a name to it.',
  'board.missed': 'This run does not make the board.',
  'board.missedBy': 'Not the top {size} — the last place on it survived {time}.',
  'board.needName': 'A name, however short.',
  'board.failOffline': 'The board did not answer. The run still happened.',
  'board.failRefused': 'The board did not believe that run.',
  'board.failTooMany': 'Too many submissions from here just now. Give it a few minutes.',
  'board.failInvalid': 'That run does not add up, so it was not sent.',
  // English needs two forms and Russian three, so the noun is a lookup rather
  // than part of the sentence. See `plural()`.
  'plural.boss.one': 'boss',
  'plural.boss.few': 'bosses',
  'plural.boss.many': 'bosses',

  // Card furniture: badges, stack counters, the one-use note.
  'offer.new': 'NEW',
  'offer.level': 'Lv',
  'offer.max': 'MAX',
  'badge.weapon': 'WEAPON',
  'badge.upgrade': 'UPGRADE',
  'badge.mod': 'MOD',
  'badge.survive': 'SURVIVE',
  'badge.clear': 'CLEAR',
  'badge.gather': 'GATHER',
  'spoil.oneUse': 'ONE USE',

  'lang.label': 'Language',

  'help.section.deal': 'The deal',
  'help.section.controls': 'Controls',
  'help.section.loop': 'How you get stronger',
  'help.section.weapons': 'The weapons',
  'help.section.dangers': 'What kills you',

  'help.deal.attack.term': 'You never attack',
  'help.deal.attack.detail':
    'Every weapon fires itself, at whatever is nearest. The only decision your hands make is where to stand.',
  'help.deal.finish.term': 'There is no finish line',
  'help.deal.finish.detail':
    'The run has no length. Enemies arrive faster and tougher every minute, a boss lands each time the clock runs another {interval}, and felling one only buys you until the next. The only ending is yours.',
  'help.deal.life.term': 'One life',
  'help.deal.life.detail':
    'Health does not come back on its own. A chest can hand you half of it, and a Vitality card pays back exactly what it adds — everything else you lose stays lost for the rest of the run.',
  'help.deal.score.term': 'The score is how long',
  'help.deal.score.detail':
    'Time survived and bosses felled. Both come from the same thing — staying alive — so there is nothing to trade one for.',

  'help.controls.move.detail': 'Move. Arrow keys do the same thing.',
  'help.controls.click.gesture': 'Right-click',
  'help.controls.click.detail':
    'Walk to that spot and stop there. Hold the button instead and you keep walking toward the cursor for as long as it is down, which is the steadier way to kite. Touching a movement key takes the wheel back at once, so an order can never carry you somewhere you did not want to go.',
  'help.controls.drag.gesture': 'Drag anywhere',
  'help.controls.drag.detail':
    'A stick appears under your thumb wherever it lands. How far you push it is how fast you go, so a small push is a slow, precise step.',
  'help.controls.cards.detail':
    'Take that card — an upgrade at a level, a spoil at a chest. Clicking it does the same.',
  'help.controls.tap.gesture': 'Tap a card',
  'help.controls.tap.detail': 'Take that upgrade, or that spoil.',
  'help.controls.pause.detail': 'Pause. So does P.',
  'help.controls.pauseButton.gesture': 'The pause button',
  'help.controls.pauseButton.detail':
    'Freezes the run. The round button in the bottom corner, always on screen.',
  'help.controls.restart.detail':
    'Start over. On the pause screen it asks twice before throwing the run away.',
  'help.controls.blur.term': 'Leaving the window',
  'help.controls.blur.detail':
    'Clicking away pauses the run on its own. Coming back does not resume it — you get to look at the screen first.',

  'help.loop.gems.term': 'Kills drop gems',
  'help.loop.gems.detail':
    'Walk over a gem to take it, or let it come to you — anything within {radius} pixels flies in on its own.',
  'help.loop.xp.term': 'Gems are the only XP',
  'help.loop.xp.detail':
    'An enemy you hurt but did not kill is worth nothing, and one that wanders off the map takes its gem with it.',
  'help.loop.chest.term': 'Chests are somewhere else',
  'help.loop.chest.detail':
    'One chest waits on the ground at a time and it is always behind you, on ground you have already crossed. An arrow at the edge of the screen points at it until you take it — it never expires, and the next one is not placed until this one is gone.',
  'help.loop.spoil.term': 'A chest holds one of three',
  'help.loop.spoil.detail':
    'Health, the horde killed where it stands, or every gem you walked past coming to you. One of each, always, so there is something in it whatever kind of trouble you are in. It is spent the moment you take it.',
  'help.loop.starter.term': 'You choose what you open with',
  'help.loop.starter.detail':
    'Every run starts with one weapon and you pick which. It decides the first minutes, who you are on screen, and what the level-up cards have to build on — nothing else is decided for you.',
  'help.loop.levels.term': 'Levels are the only upgrades',
  'help.loop.levels.detail':
    'Each level stops the run and offers {offers} cards. There is no shop and nothing to save for: what you pick is what you get.',
  'help.loop.stack.term': 'Cards stack',
  'help.loop.stack.detail':
    'A card naming a weapon you do not own grants it; taking it again levels it. Every card says how many times it can still be taken.',

  'help.danger.touch.term': 'Touching anything hurts',
  'help.danger.touch.detail':
    'Contact costs health and buys {grace} seconds of grace. Standing inside a crowd spends that grace the moment it runs out, over and over.',
  'help.danger.aim.term': 'They aim where you are going',
  'help.danger.aim.detail':
    'Most spawns are placed in your path rather than behind you, so running in a straight line runs you into the next wave.',
  'help.danger.boss.term': 'The boss',
  'help.danger.boss.detail':
    'The first arrives with {hp} health and hits for {damage}, and every one after it is tougher than the last. The horde stops for the duel — but only for {duel} seconds, so a boss you cannot finish is one you fight in traffic.',
  'help.danger.remember.term': 'If you remember one thing',
  'help.danger.remember.detail':
    'Keep moving, and never let a crowd close around you. Standing still is what ends runs.',
} as const;

/** Every string the interface can ask for. Derived, so it cannot fall behind. */
export type StringId = keyof typeof EN;
