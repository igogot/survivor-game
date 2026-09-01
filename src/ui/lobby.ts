import { t } from '../i18n';
import { isCode, normaliseCode, secureRandom } from '../net/code';
import { Lobby, MAX_PARTY } from '../net/lobby';
import { openLobbyChannel } from '../net/channel';
import { requireElement } from './hud';
import type { LobbyChannel } from '../net/channel';
import type { LobbyError, LobbyStart, LobbyState } from '../net/lobby';

/**
 * The multiplayer half of the opening screen.
 *
 * Three panels — pick create-or-join, type a code, sit in the room — driven by
 * one `Lobby`. This file is where the browser lives: it owns the channel, the
 * clock that gives up on a knock, and the clipboard. The state machine it draws
 * knows about none of that, which is what lets the whole flow be tested in Node.
 *
 * It does not start a run. The room fills, the code is readable, everybody can
 * see who is in — and the button that would begin is deliberately not here,
 * because the simulation is not networked yet and a button that pretended
 * otherwise would be the worst thing on this screen.
 */

/** How long a knock waits for an answer. A broadcast is instant or it is nobody. */
const KNOCK_TIMEOUT = 700;

/** How long the copy button says it worked. */
const COPIED_FOR = 1400;

export type LobbyStep = 'party' | 'join' | 'room';

export class LobbyView {
  private readonly partyPanel = requireElement('step-party');
  private readonly joinPanel = requireElement('step-join');
  private readonly roomPanel = requireElement('step-room');

  private readonly joinForm = requireElement('join-form');
  private readonly joinInput = requireElement('join-code');
  private readonly joinError = requireElement('join-error');
  private readonly roomCode = requireElement('room-code');
  private readonly roomRoster = requireElement('room-roster');
  private readonly copyButton = requireElement('room-copy');
  private readonly joinConfirm = requireElement('join-confirm');
  private readonly chatPanel = requireElement('room-chat');
  private readonly chatLog = requireElement('chat-log');
  private readonly chatForm = requireElement('chat-form');
  private readonly chatInput = requireElement('chat-input');
  private readonly beginButton = requireElement('room-begin');
  private readonly beginHint = requireElement('room-begin-hint');

  private readonly channel: LobbyChannel;
  private readonly lobby: Lobby;

  private step: LobbyStep = 'party';
  private knock: ReturnType<typeof setTimeout> | null = null;
  /** Lines already on screen, so an arriving one can open a shut panel. */
  private heard = 0;
  private copied: ReturnType<typeof setTimeout> | null = null;

  /**
   * `onBack` is the way out of multiplayer entirely, back to the mode choice,
   * and `onStart` is the way forward — the moment a room stops being a room and
   * becomes a run.
   */
  constructor(
    private readonly onBack: () => void,
    onStart: (start: LobbyStart) => void,
  ) {
    this.channel = openLobbyChannel((message) => {
      this.lobby.receive(message);
      this.afterChange();
    });
    this.lobby = new Lobby((message) => this.channel.send(message), secureRandom);
    this.lobby.onStart = onStart;

    requireElement('party-create').addEventListener('click', () => this.create());
    requireElement('party-join').addEventListener('click', () => this.show('join'));
    requireElement('party-back').addEventListener('click', () => this.leaveEntirely());
    requireElement('join-back').addEventListener('click', () => this.show('party'));
    requireElement('room-leave').addEventListener('click', () => this.leaveRoom());
    this.beginButton.addEventListener('click', () => this.lobby.begin());
    this.copyButton.addEventListener('click', () => void this.copy());

    this.joinForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.attemptJoin();
    });

    this.chatForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const field = this.chatInput as HTMLInputElement;
      this.lobby.say(field.value);
      field.value = '';
      this.render();
    });

    // Enter opens the chat, and Escape closes it. Bound on the window rather
    // than on a button because that is the gesture the request was for and the
    // one every game with a lobby has taught players — but only while the room
    // is actually on screen, and never while a field already has the keyboard.
    window.addEventListener('keydown', (event) => {
      if (this.roomPanel.hidden) return;
      if (event.key === 'Escape' && this.chatting()) {
        this.closeChat();
        return;
      }
      if (event.key !== 'Enter' || event.target instanceof HTMLInputElement) return;

      event.preventDefault();
      this.openChat();
    });

    // Typed straight into the shape the code has, so what is on screen while
    // typing is what will be compared. Nothing is rejected here — a wrong
    // character is a message on submit, not a key that silently does nothing.
    this.joinInput.addEventListener('input', () => {
      const field = this.joinInput as HTMLInputElement;
      field.value = field.value.toUpperCase();
    });
  }

  /** Enters the multiplayer flow at its first panel. */
  open(): void {
    this.show('party');
  }

  private chatting(): boolean {
    return !this.chatPanel.hidden;
  }

  private openChat(): void {
    this.chatPanel.hidden = false;
    this.render();
    this.chatInput.focus();
  }

  private closeChat(): void {
    this.chatPanel.hidden = true;
    this.chatInput.blur();
  }

  hide(): void {
    this.partyPanel.hidden = true;
    this.joinPanel.hidden = true;
    this.roomPanel.hidden = true;
  }

  /** Re-renders whatever is on screen after the language changed. */
  relabel(): void {
    this.render();
  }

  private show(step: LobbyStep): void {
    this.step = step;
    this.partyPanel.hidden = step !== 'party';
    this.joinPanel.hidden = step !== 'join';
    this.roomPanel.hidden = step !== 'room';

    if (step === 'join') {
      this.joinError.hidden = true;
      (this.joinInput as HTMLInputElement).value = '';
      this.joinInput.focus();
    }

    // A fresh room starts quiet. Whatever was said in the last one is not this
    // room's business, and `Lobby` has already forgotten it.
    if (step !== 'room') {
      this.chatPanel.hidden = true;
      (this.chatInput as HTMLInputElement).value = '';
    }

    this.render();
  }

  private create(): void {
    this.lobby.host();
    this.show('room');
  }

  private attemptJoin(): void {
    const typed = normaliseCode((this.joinInput as HTMLInputElement).value);
    if (!isCode(typed)) {
      this.fail('badCode');
      return;
    }

    this.joinError.hidden = true;
    this.lobby.join(typed);
    this.render();

    this.clearKnock();
    this.knock = setTimeout(() => {
      this.lobby.giveUp();
      this.afterChange();
    }, KNOCK_TIMEOUT);
  }

  /**
   * Everything that has to happen when the lobby's state moved on its own —
   * a roster arriving, a room closing, a knock timing out.
   */
  private afterChange(): void {
    const state = this.lobby.state();
    const said = state.chat.length;

    if (state.phase === 'joined') {
      this.clearKnock();
      if (this.step !== 'room') this.show('room');
    }

    // Somebody spoke while the chat was shut. Opening it is the only thing that
    // is not a lie: a closed panel that quietly collects what your team said to
    // you is worse than having no chat at all.
    if (said > this.heard && this.step === 'room') this.chatPanel.hidden = false;
    this.heard = said;

    if (state.phase === 'error') {
      this.clearKnock();
      const reason = state.error;
      this.lobby.reset();
      if (reason !== null) this.fail(reason);
      this.show('join');
      return;
    }

    this.render();
  }

  private fail(reason: LobbyError | 'badCode'): void {
    this.joinError.textContent = t(`join.${reason}`);
    this.joinError.hidden = false;
  }

  private leaveRoom(): void {
    this.lobby.leave();
    this.show('party');
  }

  private leaveEntirely(): void {
    this.lobby.leave();
    this.clearKnock();
    this.hide();
    this.onBack();
  }

  private clearKnock(): void {
    if (this.knock !== null) clearTimeout(this.knock);
    this.knock = null;
  }

  private async copy(): Promise<void> {
    const code = this.lobby.state().code;
    // Best effort: a clipboard the browser refuses is a code the player reads
    // off the screen instead, which is what it is there for.
    try {
      await navigator.clipboard?.writeText(code);
    } catch {
      return;
    }

    this.copyButton.textContent = t('room.copied');
    if (this.copied !== null) clearTimeout(this.copied);
    this.copied = setTimeout(() => {
      this.copyButton.textContent = t('room.copy');
    }, COPIED_FOR);
  }

  private render(): void {
    const state = this.lobby.state();

    this.copyButton.textContent = t('room.copy');
    this.roomCode.textContent = state.code;
    this.roomRoster.replaceChildren(...rosterRows(state));

    this.joinConfirm.textContent =
      state.phase === 'joining' ? t('join.searching') : t('join.confirm');
    (this.joinInput as HTMLInputElement).placeholder = t('join.placeholder');
    (this.chatInput as HTMLInputElement).placeholder = t('room.chatPlaceholder');

    // Only the host has a button, because only the host's machine runs the
    // world. A guest is told what it is waiting for rather than shown a control
    // that would do nothing.
    const ready = state.hosting && state.members.length > 1;
    this.beginButton.hidden = !state.hosting;
    this.beginButton.textContent = ready ? t('room.begin') : t('room.beginAlone');
    (this.beginButton as HTMLButtonElement).disabled = !ready;
    this.beginHint.textContent = state.hosting ? t('room.beginHint') : t('room.guestWait');

    this.chatLog.replaceChildren(...chatRows(state));
    // Pinned to the newest line. A log that has to be scrolled to see the reply
    // you were waiting for is a log nobody reads.
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }
}

/**
 * What has been said, oldest first.
 *
 * The seat number comes off the line rather than being looked up now — see
 * `ChatLine`. An empty log says so out loud, and says why it might be empty for
 * somebody who has only just walked in.
 */
function chatRows(state: LobbyState): HTMLElement[] {
  if (state.chat.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'chat--empty';
    empty.textContent = `${t('room.chatEmpty')} ${t('room.chatLate')}`;
    return [empty];
  }

  return state.chat.map((line) => {
    const row = document.createElement('li');
    if (line.mine) row.className = 'mine';

    const who = document.createElement('span');
    who.className = 'who';
    // A seat of -1 means the speaker had already left the roster by the time
    // their line landed; the words still happened, so they are still shown.
    who.textContent =
      line.seat < 0 ? '—' : `${t('room.chatFrom', { n: line.seat + 1 })}:`;

    const text = document.createElement('span');
    // textContent, never innerHTML: this is the one string on the page written
    // by another person.
    text.textContent = line.text;

    row.append(who, text);
    return row;
  });
}

/**
 * The room, as four seats rather than a list that grows.
 *
 * Showing the empty ones is the point: a player who can see three seats waiting
 * knows the code is worth reading out, and one who can see none knows why
 * nobody else can get in.
 */
function rosterRows(state: LobbyState): HTMLElement[] {
  const rows: HTMLElement[] = [];

  for (let seat = 0; seat < MAX_PARTY; seat++) {
    const member = state.members[seat];
    const row = document.createElement('li');

    const name = document.createElement('span');
    const tag = document.createElement('span');
    tag.className = 'tag';

    if (member === undefined) {
      row.className = 'roster--empty';
      name.textContent = t('room.slot', { n: seat + 1 });
      tag.textContent = t('room.waiting');
    } else {
      name.textContent = t('room.slot', { n: seat + 1 });
      const marks: string[] = [];
      if (seat === 0) marks.push(t('room.host'));
      if (member === state.self) marks.push(t('room.you'));
      tag.textContent = marks.join(' · ');
    }

    row.append(name, tag);
    rows.push(row);
  }

  return rows;
}
