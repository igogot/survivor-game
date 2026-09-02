import { CONFIG } from './config';
import { ClickInput } from './core/click-input';
import { GameLoop } from './core/loop';
import { autoPauseDisabled } from './dev/flags';
import { Input } from './core/input';
import { TouchInput } from './core/touch-input';
import { GameRenderer } from './render/renderer';
import { applyStaticText } from './i18n';
import { getLang, initLang } from './i18n/lang';
import { OFFERS_PER_LEVEL, applyUpgrade } from './systems/progression';
import { takeSpoil } from './systems/chests';
import { mountLanguageSwitch } from './ui/language';
import { HttpAccounts } from './net/accounts';
import { HttpLeaderboard } from './net/leaderboard';
import { boardFor } from './core/scores';
import { Hud, requireElement } from './ui/hud';
import { t } from './i18n';
import { AccountScreen } from './ui/account';
import { RecordsScreen, SubmitStrip } from './ui/records';
import {
  ChestMenu,
  PauseScreen,
  ResultScreen,
  StartScreen,
  UpgradeMenu,
  mountHelp,
  renderKeyLines,
} from './ui/menus';
import { StickView } from './ui/stick';
import { starterChoices } from './ui/starters';
import { canPause, pauseRun, resumeRun } from './world/pause';
import { stepWorld } from './world/step';
import { World } from './world/world';
import { GuestSession, HostSession } from './net/session';
import { dedupe, nonce, openGameChannel } from './net/channel';
import type { Envelope } from './net/mailbox';
import { PeerMesh } from './net/webrtc';
import { shouldSwapHost } from './net/diagnosis';
import type { NetMessage } from './net/session';
import { STARTER_WEAPON_ID } from './data/weapons';
import type { Session } from './net/session';
import type { LobbyStart } from './net/lobby';
import { isAlive, nextLiving, viewedBy } from './world/party';
import type { Player } from './world/types';

async function main(): Promise<void> {
  const host = document.getElementById('app');
  if (host === null) throw new Error('Missing #app in index.html');

  // Before anything reads a string. Every screen below is built out of text,
  // and text is read from whichever table this call selects — so a language
  // decided after the first panel exists is a panel in the wrong language.
  initLang(window.location.search);

  const renderer = new GameRenderer();
  await renderer.init(host);

  const input = new Input();
  input.attach();

  // The canvas, not the window: the HUD is `pointer-events: none` and passes
  // touches through, but the buttons and cards layered over it are not, so a
  // tap meant for a card never also starts the stick under it.
  const touch = new TouchInput();
  touch.attach(host);

  // Same surface, same reason: a right-click meant for a card or the pause
  // button must not also order a walk to the ground behind it.
  const clicks = new ClickInput();
  clicks.attach(host);

  const hud = new Hud(renderer.paintSprite);
  const stick = new StickView();
  const resultScreen = new ResultScreen(restart);
  const pauseScreen = new PauseScreen(resumeGame, restart, toMainMenu);
  const upgradeMenu = new UpgradeMenu(pickUpgrade);
  const chestMenu = new ChestMenu(pickSpoil);

  /*
   * The leaderboard is bolted to the side of the game on purpose. Nothing in
   * the tick, the renderer or the world knows it exists, every call it makes
   * is awaited off the game loop, and every failure it can have ends in a
   * sentence on a screen. A run must never be worse because a shared host in
   * another country is down.
   */
  const leaderboard = new HttpLeaderboard();
  const recordsScreen = new RecordsScreen(leaderboard, closeRecords);
  const accountScreen = new AccountScreen(new HttpAccounts(), closeAccount);
  const submitStrip = new SubmitStrip(leaderboard, (name) => {
    // Reopening the board after placing goes straight to the new row.
    placedAs = name;
  });

  /** The name this run was put on the board under, if it was. */
  let placedAs: string | undefined;
  const startScreen = new StartScreen(
    startRun,
    renderer.paintSprite,
    startTeamRun,
    STARTER_WEAPON_ID,
  );

  /** The weapons on offer, in the order their cards and their keys appear. */
  const starters = starterChoices();

  // One source of rules, printed into the briefing, the pause screen and the
  // result screen. Put on the page by `relabel` below, once there is a world
  // for it to sync the overlays against.

  const linkPanel = requireElement('link');
  /** The roster, in seat order, so a link can be named as a player number. */
  let roster: readonly string[] = [];
  let hostingRun = false;
  const memberSeat = (member: string): number => roster.indexOf(member);

  const pauseButton = document.getElementById('pause-button');
  pauseButton?.addEventListener('click', togglePause);

  // The button beside "Run again". A phone has no L key, and the board is the
  // one screen a player is meant to want to look at twice.
  document.getElementById('result-records')?.addEventListener('click', openRecordsForThisRun);
  // No confirmation on this one: the run is already over, so there is nothing
  // left for a stray click to cost.
  document.getElementById('result-menu')?.addEventListener('click', toMainMenu);
  // And from the opening screen, so the board is a thing you can look at before
  // you have anything to put on it — which is the whole reason to chase it.
  document.getElementById('start-records')?.addEventListener('click', openRecords);
  document.getElementById('start-account')?.addEventListener('click', openAccount);

  /**
   * Whether a machine is driving this page.
   *
   * The same dev flag that unwires auto-pause also skips the briefing: both
   * exist because a harness has no eyes to read with and no hand to dismiss a
   * screen. A player cannot reach it — the flag is inert outside a dev build.
   */
  const unattended = autoPauseDisabled(window.location.search, import.meta.env.DEV);

  // Reassigned on restart, so every closure below reads the binding rather than
  // capturing one instance.
  let world = newWorld();

  /**
   * The other machines, or null when there are none.
   *
   * Solo is the absence of this rather than a special case of it: with no
   * session the loop below is exactly the loop this game has always had, which
   * is what keeps every measured table in the README about the same code.
   */
  let net: Session | null = null;

  /** The peer connections this machine holds, or null outside a team run. */
  let mesh: PeerMesh | null = null;

  /**
   * Everything arriving from anybody, heard once.
   *
   * Both transports carry every message, so a second window on this machine
   * hears each of them twice. Most of what a session does is idempotent and
   * would not care — but spending a level is not, and a duplicated pick would
   * take two cards for one level.
   */
  const deliver = dedupe<NetMessage>((message) => net?.receive(world, message));

  /**
   * The player at this keyboard.
   *
   * A function rather than a binding because `world` is replaced on restart,
   * and index zero because a solo run has exactly one. It is the single place
   * this file decides whose screen it is drawing, which is what a second
   * participant would have to change and nothing else.
   */
  function me(): Player {
    return world.players[net?.guest === true ? net.seat : 0];
  }

  /** The player whose level-up menu is up, or null when nobody's is. */
  function chooser(): Player | null {
    return world.players[world.choosing] ?? null;
  }

  /**
   * Whether the opening screen is up and a weapon has yet to be chosen.
   *
   * The run is genuinely paused behind it, which means `syncOverlays` would
   * otherwise show the pause screen — the two states are the same to the
   * simulation and different to the player. This flag is what tells them
   * apart. Unlike the briefing it grew out of, it comes back on every restart:
   * the weapon is the decision a run is built around, and somebody who has
   * just watched one fail is exactly the person who wants to make it
   * differently.
   */
  let picking = !unattended;
  if (picking) pauseRun(world);

  // Text first, then the screens built out of it. `relabel` ends by syncing the
  // overlays, so this is also the first sync — and it has to happen here rather
  // than beside the other setup above, because syncing reads `world`.
  relabel();
  mountLanguageSwitch(relabel);

  const loop = new GameLoop(CONFIG.tickRate, CONFIG.maxFrameTime, tick, draw);
  loop.start();

  // Losing the window pauses the run. Deliberately one-way: regaining focus
  // does not resume, or the player is dropped straight back into damage they
  // had no chance to react to.
  //
  // A harness driving the page is the one caller that has to opt out: its tab
  // is never focused or visible, so these two would fire continuously and the
  // run could never advance. `?nopause` is dev-only, so nothing a player runs
  // can take this branch.
  if (!unattended) {
    window.addEventListener('blur', autoPause);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) autoPause();
    });
  }

  // Console handle for poking at a live run: `game.getWorld()` to inspect state,
  // `game.renderer.draw(...)` to force a frame. Dropped from production builds.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).game = {
      getWorld: () => world,
      renderer,
      loop,
      // Chrome suspends requestAnimationFrame outright in a hidden tab, so a
      // harness cannot wait for the loop to tick. This advances the same fixed
      // steps the loop would have run and draws once, with no rAF involved.
      step: (ticks = 1) => {
        for (let i = 0; i < ticks; i++) tick(1 / CONFIG.tickRate);
        draw(0);
      },
    };
  }

  /**
   * Puts every piece of text on the page into the current language.
   *
   * Three kinds of text need three different things done to them. Static lines
   * are stamped from the markup's own ids; the lines with keycaps in them are
   * rebuilt, because the caps sit in a different place in each language; and
   * everything built from game data — the rules, the opening cards, whichever
   * overlay is up — is re-rendered from its source.
   *
   * The HUD is absent on purpose: it is rewritten on every frame anyway, so it
   * is already in the new language by the time the click that changed it has
   * finished.
   */
  function relabel(): void {
    document.documentElement.lang = getLang();
    applyStaticText();
    renderKeyLines(OFFERS_PER_LEVEL);
    mountHelp(['help-start', 'help-pause', 'help-result']);
    startScreen.relabel();
    // The armed restart button says something the markup does not, so a
    // re-stamp would quietly put the calm label back under a player who had
    // already pressed once.
    pauseScreen.disarm();
    syncOverlays();
  }

  /**
   * Begins a run the lobby put together.
   *
   * Everybody builds the same world from the same seed — only the host steps
   * it, but a guest whose world disagreed about which weapons exist would draw
   * the wrong figures — and then the two roles part company: the host plays,
   * and a guest becomes a screen with a mailbox behind it.
   */
  function startTeamRun(start: LobbyStart): void {
    picking = false;
    placedAs = undefined;
    roster = start.members;
    hostingRun = start.hosting;
    // Everybody's own choice, made in the waiting room and carried here by the
    // host's roster. Same list on every machine, so every machine builds the
    // same world — which is what lets a guest draw a teammate correctly without
    // being told anything more about them.
    world = new World(start.seed, start.starters);

    // Two ways to reach the others, and both are used. The local one carries a
    // second window on this machine and costs nothing; the peer connections
    // carry another house. A message arriving twice is dropped by its nonce.
    const local = openGameChannel<Envelope<NetMessage>>((message) => deliver(message));
    mesh?.close();
    mesh = new PeerMesh(
      start.self,
      start.code,
      (message) => startScreen.signalling.signal(message),
      (message) => deliver(message),
      showLinks,
    );
    startScreen.signalling.onSignal = (message) => mesh?.receive(message);

    // The host calls; a guest waits to be called. Whoever makes the offer also
    // makes the data channel, and two of those is one too many.
    if (start.hosting) {
      for (const member of start.members) mesh.invite(member);
    }

    const channel = {
      send: (message: NetMessage) => {
        const wrapped: Envelope<NetMessage> = { n: nonce(), m: message };
        local.send(wrapped);
        mesh?.broadcast(wrapped);
      },
    };

    net = start.hosting
      ? new HostSession(channel, start.members)
      : new GuestSession(channel, start.members[start.seat], start.seat);
    showLinks();

    input.clearPressed();
    touch.reset();
    clicks.reset();
    loop.resync();
    syncOverlays();
  }

  function tick(dt: number): void {
    // Read the phase once. Branching on `world.phase` directly would let the
    // compiler narrow it for the rest of the block, and the systems below
    // change it from underneath that narrowing.
    const phase = world.phase;

    if (phase === 'paused') {
      // A panel over a panel takes the key first, or Escape would resume the
      // run from behind whatever is covering it.
      if (accountScreen.isOpen) {
        if (input.consumePressed('Escape')) closeAccount();
        return;
      }
      if (recordsScreen.isOpen) {
        if (input.consumePressed('Escape') || input.consumePressed('KeyL')) closeRecords();
        return;
      }

      if (picking) {
        // Only on the panel these keys belong to. The opening screen is a flow
        // now — mode, then a weapon or a team — and Enter inside the waiting
        // room is how a player talks to their team, not how they abandon it for
        // a solo run.
        if (!startScreen.awaitingWeapon()) return;

        // The same digits the level-up screen uses, because it is the same
        // gesture: read three cards, pick one, live with it.
        for (let i = 0; i < starters.length; i++) {
          if (input.consumePressed(`Digit${i + 1}`)) {
            // `pick`, not `startRun`: on the party path this panel is choosing
            // what to bring to a team, and a digit must not mean something the
            // mouse does not.
            startScreen.pick(starters[i].id);
            return;
          }
        }

        if (input.consumePressed('KeyL')) {
          openRecords();
          return;
        }

        // The three keys a player reaches for on a title screen, for somebody
        // who would rather not choose at all. Move keys are deliberately not
        // among them: the first thing a hand does here is settle onto WASD.
        if (
          input.consumePressed('Space') ||
          input.consumePressed('Enter') ||
          input.consumePressed('NumpadEnter')
        ) {
          startScreen.pick(starters[0].id);
        }
        return;
      }

      if (pausePressed()) {
        resumeGame();
        return;
      }
      // Same two-step confirmation as the button; the screen shows which press
      // this is.
      if (input.consumePressed('KeyR')) pauseScreen.requestRestart();
      return;
    }

    if ((phase === 'playing' || phase === 'levelup' || phase === 'chest') && pausePressed()) {
      pauseGame();
      return;
    }

    if (phase === 'playing') {
      input.poll();

      // Read before the intent, so a click and a key pressed in the same tick
      // resolve the way they should: the key wins and the order is dropped
      // inside `steeringSystem` rather than half-obeyed here.
      // A downed player steers nothing and orders nothing. What their mouse
      // does instead is move the camera along the team — see `watching`.
      const alive = isAlive(me());
      const order = alive ? clicks.consume() : null;
      const intent = alive ? combinedIntent() : { x: 0, y: 0 };
      if (net?.guest === true) {
        // A guest changes nothing here. It says what its hands are doing and
        // waits to be told what happened — the world it holds is a mailbox.
        if (alive) {
          net.sendInput(
            intent.x,
            intent.y,
            order === null ? null : renderer.screenToWorld(order.x, order.y),
          );
        } else if (clicks.consumePrimary()) {
          net.watchNext();
        }
        return;
      }

      if (alive) {
        if (order !== null) me().moveTarget = renderer.screenToWorld(order.x, order.y);
        me().intentX = intent.x;
        me().intentY = intent.y;
      } else if (clicks.consumePrimary()) {
        me().watching = nextLiving(world, me().watching);
      }

      // Every guest's hand, written where the local input layer just wrote
      // this machine's. Both have to land before the world moves.
      if (net !== null && !net.guest) net.applyInputs(world);
      stepWorld(world, dt);
      if (net !== null && !net.guest) net.publish(world, dt);
      syncOverlays();
      return;
    }

    if (phase === 'levelup') {
      const offers = chooser()?.offered ?? [];
      for (let i = 0; i < offers.length; i++) {
        if (input.consumePressed(`Digit${i + 1}`)) {
          pickUpgrade(offers[i].id);
          return;
        }
      }
      return;
    }

    // Same digits as the level-up screen, because it is the same gesture on
    // the same cards. The two never overlap: a level gained on the tick a
    // chest opened waits in `pendingLevels` until the chest is spent.
    if (phase === 'chest') {
      for (let i = 0; i < world.spoils.length; i++) {
        if (input.consumePressed(`Digit${i + 1}`)) {
          pickSpoil(world.spoils[i].id);
          return;
        }
      }
      return;
    }

    if (phase === 'dead') {
      if (accountScreen.isOpen) {
        if (input.consumePressed('Escape')) closeAccount();
        return;
      }
      if (recordsScreen.isOpen) {
        // Only a way out. Restarting from behind the board would leave it
        // covering a run that had already begun.
        if (input.consumePressed('Escape') || input.consumePressed('KeyL')) closeRecords();
        return;
      }

      if (input.consumePressed('KeyL')) {
        openRecordsForThisRun();
        return;
      }
      if (input.consumePressed('KeyR')) restart();
    }
  }

  /** Opens the board a finished run belongs on, rather than always the solo one. */
  function openRecordsForThisRun(): void {
    void recordsScreen.showFor(boardFor(world.players.length), placedAs);
  }

  function openRecords(): void {
    // Deliberately not awaited: the screen shows what it already knows at once
    // and fills in when the network answers, so opening it is never a wait.
    void recordsScreen.show(placedAs);
  }

  function closeRecords(): void {
    recordsScreen.hide();
    input.clearPressed();
  }

  function openAccount(): void {
    accountScreen.show();
  }

  function closeAccount(): void {
    accountScreen.hide();
    input.clearPressed();
  }

  function pausePressed(): boolean {
    return input.consumePressed('Escape') || input.consumePressed('KeyP');
  }

  /**
   * Keys and thumb, summed and clamped.
   *
   * Summing rather than picking a winner means neither input has to know the
   * other exists, and a phone with a keyboard attached behaves the way both
   * halves promise. The clamp is what stops holding both from moving faster
   * than either — the simulation multiplies this straight into `moveSpeed`.
   */
  function combinedIntent(): { x: number; y: number } {
    const x = input.x + touch.x;
    const y = input.y + touch.y;
    const length = Math.hypot(x, y);
    if (length <= 1) return { x, y };
    return { x: x / length, y: y / length };
  }

  function togglePause(): void {
    // The opening screen is paused too, and this button would lift that pause
    // while leaving the panel up — a run advancing behind a screen that says
    // it has not started. Choosing a weapon is the only way out of it.
    if (picking) return;

    if (world.phase === 'paused') {
      resumeGame();
      return;
    }
    if (canPause(world)) pauseGame();
  }

  function pauseGame(): void {
    pauseRun(world);
    // Otherwise the key that paused is still queued and unpauses immediately.
    input.clearPressed();
    // A finger that was steering when the phone rang is not steering any more,
    // and the world must not resume still holding its last direction.
    touch.reset();
    clicks.reset();
    syncOverlays();
  }

  /**
   * Opens a run with `weaponId`.
   *
   * Builds a new world rather than arming the paused one behind the screen:
   * the starting weapon decides both what the player is granted and which
   * figure they are, and the constructor is where those are settled. The seed
   * is re-read with it, so choosing a weapon on a `?seed` link replays that
   * seed with this weapon rather than silently ignoring one of the two.
   */
  function startRun(weaponId: string): void {
    mesh?.close();
    mesh = null;
    net = null;
    picking = false;
    placedAs = undefined;
    world = newWorld(weaponId);
    // Everything an unpause clears, for the same reason: the key or the click
    // that chose the weapon must not also be read by the run it starts.
    input.clearPressed();
    touch.reset();
    clicks.reset();
    loop.resync();
    syncOverlays();
  }

  function resumeGame(): void {
    resumeRun(world);
    input.clearPressed();
    // A click aimed at a screen that was covering the game is not a move order.
    clicks.reset();
    loop.resync();
    syncOverlays();
  }

  function autoPause(): void {
    if (!canPause(world)) return;
    pauseGame();
  }

  /**
   * Says what the peer-to-peer layer is doing, and only when it has something
   * to say.
   *
   * WebRTC fails silently, and silence in a waiting room is indistinguishable
   * from a broken game. It cannot always be fixed — two machines behind
   * symmetric NAT genuinely cannot reach each other without a relay this
   * project does not run — but a player who is told *why* can do something
   * about it, and one who is not decides the game is broken.
   */
  function showLinks(): void {
    const reports = mesh?.report() ?? [];
    const lines: HTMLElement[] = [];

    for (const link of reports) {
      if (link.state === 'open') continue;

      const line = document.createElement('div');
      const who = t('hud.player', { n: 1 + Math.max(0, memberSeat(link.member)) });

      if (link.state === 'connecting') line.textContent = t('link.connecting');
      else if (link.diagnosis !== null) line.textContent = t(`link.${link.diagnosis}`, { who });
      lines.push(line);

      if (link.diagnosis !== null) {
        const advice = document.createElement('div');
        advice.className = 'advice';
        advice.textContent = shouldSwapHost(
          { everConnected: false, sawPublicAddress: true, heardFromPeer: true, hosting: hostingRun },
          link.diagnosis,
        )
          ? t('link.swapHost')
          : t('link.tryAgain');
        lines.push(advice);
      }
    }

    linkPanel.replaceChildren(...lines);
    linkPanel.hidden = lines.length === 0;
  }

  function draw(alpha: number): void {
    // Whose eyes: their own while they are standing, and a teammate's while
    // they are not. One answer for the camera and the bars alike, so a
    // spectator's screen is a coherent view of somebody else rather than a
    // camera over there and a health bar over here.
    const eyes = viewedBy(world, me());
    renderer.draw(world, eyes, alpha);
    hud.update(world, eyes, me());
    stick.update(touch);
  }

  function pickUpgrade(id: string): void {
    const player = chooser();
    if (player === null) return;

    // On a guest a pick is a request, not a change: the host owns the world and
    // the cards were its roll. The menu closes when the snapshot saying so
    // arrives, which is the same rule every other thing on screen follows.
    if (net?.guest === true) net.pick(id);
    else applyUpgrade(world, player, id);
    // Otherwise a still-held number key would immediately eat the next offer.
    input.clearPressed();
    // Only the click: a right button still down goes on steering, which is the
    // whole point of holding it.
    clicks.clearPending();
    syncOverlays();
  }

  /**
   * Same handling as an upgrade, for the same two reasons.
   *
   * A chest can be followed immediately by a level-up screen — a sweep kills
   * the whole field and every body drops its gem — so the held digit that
   * spent the spoil must not also take the first card of the menu behind it.
   */
  function pickSpoil(id: string): void {
    const player = chooser();
    if (player === null) return;

    if (net?.guest === true) net.takeSpoil(id);
    else takeSpoil(world, player, id);
    input.clearPressed();
    clicks.clearPending();
    syncOverlays();
  }

  /** Single source of truth for which overlay is visible. */
  function syncOverlays(): void {
    if (world.phase === 'paused' && picking) {
      startScreen.show();
    } else {
      startScreen.hide();
    }

    if (world.phase === 'paused' && !picking) {
      pauseScreen.show();
    } else {
      pauseScreen.hide();
    }

    const picker = chooser();
    if (world.phase === 'levelup' && picker !== null) {
      upgradeMenu.show(picker.offered, picker.stacks);
    } else {
      upgradeMenu.hide();
    }

    if (world.phase === 'chest') {
      chestMenu.show(world.spoils);
    } else {
      chestMenu.hide();
    }

    if (world.phase === 'dead') {
      resultScreen.show(world);
      void offerTheBoard(world);
    } else {
      resultScreen.hide();
      submitStrip.hide();
      recordsScreen.hide();
      accountScreen.hide();
    }
  }

  /**
   * Asks the board whether this run belongs on it.
   *
   * Fetched at the moment of death rather than kept warm during the run: the
   * board is only ever read here and on the records screen, and a request in
   * flight while the horde is on screen is a request that can cost a frame.
   */
  async function offerTheBoard(world: World): Promise<void> {
    /*
     * A guest never submits.
     *
     * The run belongs to one party, so four people offering it would be four
     * rows for one run — and the guest's world is a copy of the host's, told
     * to it after the fact. The host has the authority and the roster, so the
     * host is the one who files it.
     */
    if (net?.guest === true) return;

    const finished = world;
    const kind = boardFor(world.players.length);
    const result = await leaderboard.read(kind);

    // The player may have restarted while this was in the air. Anything shown
    // now would be about a run that is already over and gone.
    if (world !== finished || world.phase !== 'dead') return;

    await submitStrip.offer(finished, result.board, result.reachable);
  }

  /**
   * Throws the run away and asks for a weapon again.
   *
   * Back to the choice rather than straight into another run with the same
   * one. A harness has nobody to ask, so it restarts into the default and
   * keeps going.
   */
  /**
   * Leaves the run, and the team with it.
   *
   * `restart` already lands on the mode choice — `StartScreen.show` opens
   * there, because a restart is a chance to play differently. What it does not
   * do is put the connection down: the mesh and the session outlive it, so a
   * player who restarted out of a party arrived at the menu still wired to
   * everybody they had just left.
   *
   * Named for where it goes rather than what it ends, because that is the
   * question somebody paused in a coop run is asking. `startRun` already tears
   * the mesh down for the solo path; this is the same teardown reached from a
   * run rather than from a weapon card.
   */
  function toMainMenu(): void {
    mesh?.close();
    mesh = null;
    net = null;
    restart();
  }

  function restart(): void {
    if (unattended) {
      startRun(STARTER_WEAPON_ID);
      return;
    }

    picking = true;
    placedAs = undefined;
    world = newWorld();
    pauseRun(world);
    input.clearPressed();
    touch.reset();
    clicks.reset();
    // A fresh run should not inherit whatever the accumulator was holding.
    loop.resync();
    syncOverlays();
  }
}

/**
 * `?seed=123` replays an exact run — the whole simulation is deterministic for
 * a given seed, which makes a bug report reproducible instead of anecdotal.
 */
function newWorld(starterId?: string): World {
  const requested = new URLSearchParams(window.location.search).get('seed');
  const parsed = requested === null ? Number.NaN : Number.parseInt(requested, 10);
  return new World(Number.isFinite(parsed) ? parsed : Date.now() >>> 0, starterId);
}

/*
 * Nothing catches a failure in here except this.
 *
 * `void main()` swallowed it: setup is async, so anything thrown after the
 * first await became an unhandled rejection that never reached the console,
 * and the symptom was a game that drew its opening screen and then quietly did
 * not work. A blank message on the page is worth more than a silent one.
 */
main().catch((error: unknown) => {
  console.error('Survivor failed to start', error);
  const host = document.getElementById('app');
  if (host !== null) {
    host.textContent = 'Something went wrong starting the game. The console has the details.';
  }
});
