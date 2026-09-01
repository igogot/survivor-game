import { getLang, isLang, onLangChange, setLang } from '../i18n/lang';

/**
 * The language switch, wired wherever it appears on the page.
 *
 * There are two of them — the opening screen and the pause screen — because
 * those are the two moments a player is reading rather than running, and a
 * setting behind a menu nobody opens mid-fight is a setting nobody finds. Both
 * are driven from one place so they cannot disagree about which language is on.
 *
 * The buttons say EN and RU rather than naming the languages in words. Two
 * letters need no translation, which means the switch reads the same to
 * somebody who cannot read the page it is sitting on — the exact person it is
 * there for.
 */
export function mountLanguageSwitch(onChange: () => void): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.lang[data-lang]'));

  for (const button of buttons) {
    const lang = button.dataset.lang;
    if (!isLang(lang)) continue;
    button.addEventListener('click', () => setLang(lang));
  }

  const markCurrent = (): void => {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.lang === getLang()));
    }
  };

  onLangChange(() => {
    markCurrent();
    onChange();
  });

  markCurrent();
}
