import type { StringId } from './en';

/**
 * The same interface, in Russian.
 *
 * Typed against `StringId` rather than written freehand, so a line added to
 * `en.ts` and forgotten here stops the build instead of shipping as a blank
 * card or an English sentence in a Russian panel.
 *
 * `result.sub.many` carries one placeholder English does not need: Russian
 * counts in three forms, so the noun itself is filled in by `pluralRu` rather
 * than baked into the sentence.
 */
export const RU: Record<StringId, string> = {
  'hud.level': 'УР',
  'hud.kills': 'убийств',
  'hud.bosses': 'боссов',
  'hud.enemies': 'врагов',
  'hud.pool': 'пул',
  'hud.byline': 'автор igogot',
  'hud.bossName': 'КОНЕЦ ОРДЫ',
  'hud.bossWarning': 'БОСС НА ПОДХОДЕ',
  'hud.pauseLabel': 'Пауза',

  'levelup.title': 'Новый уровень',
  'levelup.sub': 'Выбери одну — нажми {keys} или кликни',

  'chest.title': 'Сундук',
  'chest.sub': 'Одно из трёх, и срабатывает сразу, как возьмёшь',

  'start.title': 'Survivor',
  'start.sub': 'Одна жизнь, финиша нет. Выбери, с чем начинаешь.',
  'start.press': 'нажми',
  'start.spaceTakes': 'берёт первое',
  'start.touchHint': 'коснись оружия, чтобы начать',

  'pause.title': 'Пауза',
  'pause.sub': '{esc} или {p} — продолжить · {r} — начать заново',
  'pause.resume': 'Продолжить',
  'pause.restart': 'Начать заново',
  'pause.restartArmed': 'Точно? Забег пропадёт',

  'result.title': 'Забег окончен',
  'result.died': 'Ты погиб',
  'result.survived': 'продержался',
  'result.kills': 'убийств',
  'result.level': 'уровень',
  'result.bosses': 'боссов',
  'result.hint': 'Нажми {r}, чтобы начать заново',
  'result.again': 'Ещё забег',
  'result.sub.none': 'Орда не кончается. Попробуй стоять где-нибудь ещё.',
  'result.sub.one': 'Один босс повержен. Орду это не остановило.',
  'result.sub.many': '{count} {bosses} повержено. Орду это не остановило.',

  // Таблица рекордов.
  'board.title': 'Рекорды',
  'board.sub': 'Сто самых долгих забегов',
  'board.open': 'Рекорды',
  'board.back': 'Назад',
  'board.loading': 'Загрузка…',
  'board.empty': 'Рекордов ещё нет. Будь первым.',
  'board.unreachable': 'Таблица недоступна — этот забег останется между нами.',
  'board.offlineStale': 'Не удалось обновить — показано загруженное раньше',
  'board.offlineEmpty': 'Отсюда таблица недоступна',
  'board.nameLabel': 'Имя для таблицы рекордов',
  'board.namePlaceholder': 'твоё имя',
  'board.send': 'В таблицу',
  'board.sending': 'Отправляем…',
  'board.placed': '{place} в таблице.',
  'board.placedLate': 'Отправлено — но таблица успела заполниться.',
  'board.qualifies': 'Это {place} место. Впиши имя.',
  'board.missed': 'Этот забег в таблицу не попадает.',
  'board.missedBy': 'Не в топ-{size} — последнее место в нём продержалось {time}.',
  'board.needName': 'Имя, хоть какое-нибудь.',
  'board.failOffline': 'Таблица не ответила. Забег всё равно был.',
  'board.failRefused': 'Таблица не поверила в этот забег.',
  'board.failTooMany': 'Слишком много отправок отсюда. Подожди несколько минут.',
  'board.failInvalid': 'Этот забег не сходится, поэтому не отправлен.',
  'plural.boss.one': 'босс',
  'plural.boss.few': 'босса',
  'plural.boss.many': 'боссов',

  'offer.new': 'НОВОЕ',
  'offer.level': 'Ур',
  'offer.max': 'МАКС',
  'badge.weapon': 'ОРУЖИЕ',
  'badge.upgrade': 'УЛУЧШЕНИЕ',
  'badge.mod': 'МОД',
  'badge.survive': 'ВЫЖИТЬ',
  'badge.clear': 'ЗАЧИСТИТЬ',
  'badge.gather': 'СОБРАТЬ',
  'spoil.oneUse': 'ОДИН РАЗ',

  'lang.label': 'Язык',

  'help.section.deal': 'Уговор',
  'help.section.controls': 'Управление',
  'help.section.loop': 'Как становиться сильнее',
  'help.section.weapons': 'Оружие',
  'help.section.dangers': 'Что тебя убивает',

  'help.deal.attack.term': 'Ты никогда не атакуешь',
  'help.deal.attack.detail':
    'Всё оружие стреляет само, по тому, кто ближе. Единственное, что решают твои руки, — где стоять.',
  'help.deal.finish.term': 'Финиша нет',
  'help.deal.finish.detail':
    'У забега нет длины. Каждую минуту враги приходят чаще и злее, каждые {interval} на часах приходит босс, и повергнутый покупает время только до следующего. Единственный конец — твой.',
  'help.deal.life.term': 'Одна жизнь',
  'help.deal.life.detail':
    'Здоровье само не возвращается. Сундук может отдать половину, карта «Живучесть» возвращает ровно столько, сколько добавляет, — всё остальное, что ты потерял, потеряно до конца забега.',
  'help.deal.score.term': 'Счёт — это время',
  'help.deal.score.detail':
    'Сколько продержался и сколько боссов свалил. И то и другое растёт из одного — из того, что ты жив, — поэтому менять одно на другое не на что.',

  'help.controls.move.detail': 'Движение. Стрелки делают то же самое.',
  'help.controls.click.gesture': 'Правый клик',
  'help.controls.click.detail':
    'Идти в эту точку и там остановиться. Если держать кнопку, будешь идти за курсором, пока она нажата, — так кайтить ровнее. Любая клавиша движения сразу забирает руль обратно, поэтому приказ не может увезти тебя туда, куда ты уже не хочешь.',
  'help.controls.drag.gesture': 'Провести пальцем',
  'help.controls.drag.detail':
    'Стик появляется под большим пальцем там, где он опустился. Насколько сильно его отклонишь — настолько быстро идёшь, поэтому лёгкое касание это медленный точный шаг.',
  'help.controls.cards.detail':
    'Взять эту карту — улучшение на уровне, трофей у сундука. Клик делает то же самое.',
  'help.controls.tap.gesture': 'Коснуться карты',
  'help.controls.tap.detail': 'Взять это улучшение или этот трофей.',
  'help.controls.pause.detail': 'Пауза. P тоже.',
  'help.controls.pauseButton.gesture': 'Кнопка паузы',
  'help.controls.pauseButton.detail':
    'Замораживает забег. Круглая кнопка в нижнем углу, всегда на экране.',
  'help.controls.restart.detail':
    'Начать заново. На экране паузы спрашивает дважды, прежде чем выбросить забег.',
  'help.controls.blur.term': 'Уйти из окна',
  'help.controls.blur.detail':
    'Если переключиться на другое окно, забег встаёт на паузу сам. Возвращение его не снимает — сначала дадут посмотреть на экран.',

  'help.loop.gems.term': 'С убитых падают кристаллы',
  'help.loop.gems.detail':
    'Пройди по кристаллу, чтобы забрать, или дай ему прилететь самому: всё, что ближе {radius} пикселей, притягивается без тебя.',
  'help.loop.xp.term': 'Опыт бывает только из кристаллов',
  'help.loop.xp.detail':
    'Раненый, но не добитый враг не стоит ничего, а тот, кто ушёл за край карты, унёс свой кристалл с собой.',
  'help.loop.chest.term': 'Сундуки лежат в стороне',
  'help.loop.chest.detail':
    'На земле ждёт один сундук за раз, и он всегда позади — на земле, которую ты уже прошёл. Стрелка у края экрана показывает на него, пока не заберёшь: он не пропадает, а следующий не появится, пока стоит этот.',
  'help.loop.spoil.term': 'В сундуке одно из трёх',
  'help.loop.spoil.detail':
    'Здоровье, орда, убитая там, где стоит, или все кристаллы, мимо которых ты прошёл. Всегда по одному каждого вида, поэтому в сундуке есть что взять в любой беде. Тратится в тот же миг, как возьмёшь.',
  'help.loop.starter.term': 'Ты выбираешь, с чем начать',
  'help.loop.starter.detail':
    'Каждый забег начинается с одного оружия, и какого — решаешь ты. Оно определяет первые минуты, то, кем ты выглядишь на экране, и то, на что будут ложиться карты уровней. Больше за тебя не решают ничего.',
  'help.loop.levels.term': 'Улучшения бывают только с уровней',
  'help.loop.levels.detail':
    'Каждый уровень останавливает забег и предлагает {offers} карты. Магазина нет и копить не на что: что взял, то и получил.',
  'help.loop.stack.term': 'Карты складываются',
  'help.loop.stack.detail':
    'Карта с оружием, которого у тебя нет, выдаёт его; взятая снова — поднимает уровень. На каждой карте написано, сколько раз её ещё можно взять.',

  'help.danger.touch.term': 'Любое касание ранит',
  'help.danger.touch.detail':
    'Контакт стоит здоровья и даёт {grace} секунды неуязвимости. Если стоять внутри толпы, эта передышка тратится ровно в тот миг, когда кончается, и так по кругу.',
  'help.danger.aim.term': 'Их ставят туда, куда ты идёшь',
  'help.danger.aim.detail':
    'Большая часть врагов появляется у тебя по курсу, а не за спиной, поэтому бег по прямой — это бег в следующую волну.',
  'help.danger.boss.term': 'Босс',
  'help.danger.boss.detail':
    'Первый приходит с {hp} здоровья и бьёт на {damage}, и каждый следующий крепче предыдущего. На дуэль орда останавливается — но только на {duel} секунд, поэтому босс, которого ты не успел добить, — это босс, с которым ты дерёшься в толпе.',
  'help.danger.remember.term': 'Если запоминать одно',
  'help.danger.remember.detail':
    'Не останавливайся и не давай толпе сомкнуться вокруг. Забеги кончаются именно на месте.',
};
