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
  'hud.player': 'Игрок {n}',
  'hud.down': '{who} выбыл — вернётся через {clock}',
  'hud.watching': 'смотрим за {who} · левая кнопка переключает',
  'hud.level': 'УР',
  'hud.kills': 'убийств',
  'hud.bosses': 'боссов',
  'hud.enemies': 'врагов',
  'hud.pool': 'пул',
  'hud.byline': 'автор igogot',
  'hud.bossName': 'КОНЕЦ ОРДЫ',
  'hud.bossWarning': 'БОСС НА ПОДХОДЕ',
  'boss.charge': 'РЫВОК',
  'boss.summon': 'ЗОВ',
  'boss.volley': 'ЗАЛП',
  'boss.burst': 'РАЗЛЁТ',
  'boss.quake': 'ТОЛЧОК',
  'boss.enrage': 'ЗАГНАННЫЙ',
  'boss.leech': 'КОРМЛЕНИЕ',
  'boss.blink': 'ПРЕСЛЕДОВАТЕЛЬ',
  'boss.ward': 'ПОД ЩИТОМ',
  'boss.thorns': 'ЗЕРКАЛО',
  'hud.pauseLabel': 'Пауза',

  'levelup.title': 'Новый уровень',
  'levelup.sub': 'Выбери одну — нажми {keys} или кликни',

  'chest.title': 'Сундук',
  'chest.sub': 'Одно из трёх, и срабатывает сразу, как возьмёшь',

  'mode.title': 'Survivor',
  'mode.sub': 'Одна жизнь, финиша нет. В одиночку или с компанией.',
  'mode.solo': 'Одиночный забег',
  'mode.soloHint': 'Один игрок против орды. Всё, что ниже, — про это.',
  'mode.party': 'Мультиплеер',
  'mode.partyHint': 'До четверых в одной орде. Команда собирается по коду.',
  'mode.back': 'Назад',

  'party.title': 'Мультиплеер',
  'party.sub': 'Кто-то создаёт команду, остальные к ней присоединяются.',
  'party.create': 'Создать команду',
  'party.createHint': 'Вам выдадут код. Прочитайте его тем, кто играет с вами.',
  'party.join': 'Войти по коду',
  'party.joinHint': 'Код можно узнать только у того, кто уже ждёт в команде.',

  'join.title': 'Вход в команду',
  'join.sub': 'Шесть символов, от того, кто уже в комнате.',
  'join.placeholder': 'код',
  'join.confirm': 'Войти',
  'join.searching': 'Стучимся…',
  'join.badCode': 'Код — это шесть букв и цифр, и в нём никогда нет O, I, L, 0, 1 и 5.',
  'join.notFound': 'По этому коду никто не ждёт.',
  'join.full': 'В этой команде уже четверо.',
  'join.closed': 'Команду закрыли.',

  'room.title': 'Комната ожидания',
  'room.codeLabel': 'Код команды',
  'room.codeHint': 'Его видят все в комнате. Снаружи его не угадать.',
  'room.copy': 'Копировать',
  'room.copied': 'Скопировано',
  'room.roster': 'В команде',
  'room.you': 'вы',
  'room.host': 'создал',
  'room.slot': 'Игрок {n}',
  'room.waiting': 'ждём, пока займут место',
  'room.chatHint': 'нажмите {keys}, чтобы написать команде',
  'room.chatOpen': 'Чат',
  'room.chatPlaceholder': 'напишите что-нибудь',
  'room.chatEmpty': 'Пока ничего не сказано.',
  'room.chatFrom': 'Игрок {n}',
  'room.chatLate': 'Слышно только то, что сказали после вашего прихода.',
  'room.leave': 'Выйти из команды',
  'room.notYet': 'Команда собирается, но сам забег по сети пока не идёт — это следующая работа, и этот экран — дверь в неё.',
  'room.reach': 'Код добивает до других окон этого браузера. За пределы машины он пока не уходит.',

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
  'board.needName': 'Одно слово, без пробелов, и не пустое.',
  'board.failOffline': 'Таблица не ответила. Забег всё равно был.',
  'board.failRefused': 'Таблица не поверила в этот забег.',
  'board.failTooMany': 'Слишком много отправок отсюда. Подожди несколько минут.',
  'board.failInvalid': 'Этот забег не сходится, поэтому не отправлен.',
  'board.failNameTaken': 'Это имя занято. Войди под ним или возьми другое.',
  'board.nameRule': 'Одно слово. Имена, которые выглядят одинаково, считаются одним именем.',

  // Аккаунты — дело добровольное.
  'account.title': 'Твоё имя',
  'account.open': 'Аккаунт',
  'account.sub': 'Имя становится твоим, как только ты им воспользовался. Пароль нужен только чтобы сохранить его в другом месте.',
  'account.name': 'Имя',
  'account.password': 'Пароль',
  'account.login': 'Войти',
  'account.register': 'Зарегистрировать',
  'account.protect': 'Закрепить имя паролем',
  'account.holding': 'Имя {name} держится только этим браузером.',
  'account.protected': 'Готово. Теперь под {name} можно войти откуда угодно.',
  'account.loggedIn': 'Вошёл как {name}.',
  'account.signOut': 'Выйти',
  'account.signedOut': 'Вышел. Этот браузер больше не держит имя.',
  'account.noRecovery': 'Восстановить пароль нельзя — почта не собирается, так что забытый пароль это потерянное имя.',
  'account.working': 'Секунду…',
  'account.failOffline': 'Таблица не ответила.',
  'account.failInsecure': 'Страница открыта без шифрования, пароль с неё не отправляется.',
  'account.failWrong': 'Имя и пароль не сходятся.',
  'account.failNameTaken': 'Это имя уже занято.',
  'account.failNotYours': 'Этот браузер не держит такое имя.',
  'account.failAlreadyProtected': 'У этого имени уже есть пароль.',
  'account.failPasswordShort': 'Минимум {min} символов.',
  'account.failTooMany': 'Слишком много попыток отсюда. Подожди несколько минут.',
  'account.failName': 'Одно слово, без пробелов, и не пустое.',
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
