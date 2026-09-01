import { requireElement } from './hud';
import { MAX_NAME_LENGTH, cleanName } from '../core/scores';
import { forgetToken, loadIdentity } from '../net/identity';
import { t } from '../i18n';
import type { AccountFailure, HttpAccounts } from '../net/accounts';
import type { StringId } from '../i18n/en';

/**
 * The screen for players who want their name to outlive this browser.
 *
 * Everything here is optional and the panel says so. A name is already yours
 * the moment you use it — the board claims it and hands this browser a token —
 * so the only thing an account buys is that the name survives a cleared cache
 * and moves to another machine. Presenting it as a sign-up would make the
 * ordinary path look like the one that needs explaining.
 *
 * Which is why the panel leads with what the player already has. Somebody
 * holding a name by token is shown that, and offered to keep it; somebody
 * holding nothing gets the two fields. The distinction is the whole interface.
 */
export class AccountScreen {
  private readonly root = requireElement('account');
  private readonly status = requireElement('account-status');
  private readonly held = requireElement('account-held');
  private readonly form = requireElement('account-form');
  private readonly nameInput = requireElement('account-name') as HTMLInputElement;
  private readonly passwordInput = requireElement('account-password') as HTMLInputElement;
  private readonly loginButton = requireElement('account-login') as HTMLButtonElement;
  private readonly registerButton = requireElement('account-register') as HTMLButtonElement;
  private readonly protectButton = requireElement('account-protect') as HTMLButtonElement;
  private readonly signOutButton = requireElement('account-signout') as HTMLButtonElement;

  constructor(
    private readonly accounts: HttpAccounts,
    onClose: () => void,
  ) {
    this.nameInput.maxLength = MAX_NAME_LENGTH;

    requireElement('account-close').addEventListener('click', onClose);
    this.loginButton.addEventListener('click', () => void this.run('login'));
    this.registerButton.addEventListener('click', () => void this.run('register'));
    this.protectButton.addEventListener('click', () => void this.run('protect'));
    this.signOutButton.addEventListener('click', () => this.signOut());

    // Enter is what a hand does in a password field, and the commonest reason
    // to be here is signing back in rather than making a new name.
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.run('login');
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.status.textContent = '';
    this.passwordInput.value = '';
    this.describeWhatIsHeld();
  }

  hide(): void {
    this.root.hidden = true;
    // Never left sitting in a field behind a closed panel.
    this.passwordInput.value = '';
  }

  /**
   * Says what this browser currently holds, and offers the next step from it.
   *
   * The three states a player can be in — holding nothing, holding a name by
   * token, or signed in — want different things, and showing all the buttons
   * at once would make the panel a quiz.
   */
  private describeWhatIsHeld(): void {
    const { name, token, kept } = loadIdentity();
    const holdsSomething = name !== '' && token !== '';

    this.nameInput.value = name;
    this.held.hidden = !holdsSomething;
    this.held.textContent = holdsSomething
      ? t(kept ? 'account.loggedIn' : 'account.holding', { name })
      : '';

    // Offered only to somebody who holds a name that nothing but this browser
    // is keeping. Showing it to a signed-in player would be offering a second
    // password for a name that has one, which the server refuses — an action
    // that can only fail is worse than no action.
    this.protectButton.hidden = !holdsSomething || kept;
    this.signOutButton.hidden = !holdsSomething;
  }

  private async run(action: 'login' | 'register' | 'protect'): Promise<void> {
    const name = cleanName(this.nameInput.value);
    if (name === null) {
      this.say(t('account.failName'));
      return;
    }

    const identity = loadIdentity();
    this.busy(true);
    this.say(t('account.working'));

    const result = await this.accounts.send(
      action,
      action === 'protect' ? identity.name : name,
      this.passwordInput.value,
      identity.token,
    );

    this.busy(false);
    this.passwordInput.value = '';

    if (!result.ok) {
      this.say(t(FAILURE_TEXT[result.reason], { min: MIN_PASSWORD_LENGTH }));
      return;
    }

    this.say(t(action === 'protect' ? 'account.protected' : 'account.loggedIn', {
      name: result.name,
    }));
    this.describeWhatIsHeld();
  }

  private signOut(): void {
    forgetToken();
    this.say(t('account.signedOut'));
    this.describeWhatIsHeld();
  }

  /**
   * Disabled for the whole round trip.
   *
   * The endpoint counts every attempt against a tight allowance, so a double
   * click is the easiest way for a player to spend it on nothing.
   */
  private busy(working: boolean): void {
    this.loginButton.disabled = working;
    this.registerButton.disabled = working;
    this.protectButton.disabled = working;
  }

  private say(text: string): void {
    this.status.textContent = text;
  }
}

/**
 * The shortest password the server will take.
 *
 * Repeated here only to put the number in the sentence that reports it. The
 * server is the one that decides, and it refuses independently — this is the
 * message, not the rule.
 */
const MIN_PASSWORD_LENGTH = 8;

const FAILURE_TEXT: Readonly<Record<AccountFailure, StringId>> = {
  offline: 'account.failOffline',
  insecure: 'account.failInsecure',
  wrongCredentials: 'account.failWrong',
  nameTaken: 'account.failNameTaken',
  notYours: 'account.failNotYours',
  alreadyProtected: 'account.failAlreadyProtected',
  passwordShort: 'account.failPasswordShort',
  tooMany: 'account.failTooMany',
  name: 'account.failName',
};
