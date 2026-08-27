import { describe, expect, it } from 'vitest';
import { autoPauseDisabled } from '../src/dev/flags';

describe('autoPauseDisabled', () => {
  it('is off by default, so players keep auto-pause', () => {
    expect(autoPauseDisabled('', true)).toBe(false);
    expect(autoPauseDisabled('?', true)).toBe(false);
    expect(autoPauseDisabled('?something=else', true)).toBe(false);
  });

  it('is honoured in a dev build', () => {
    expect(autoPauseDisabled('?nopause', true)).toBe(true);
    expect(autoPauseDisabled('?nopause=1', true)).toBe(true);
    expect(autoPauseDisabled('?debug&nopause', true)).toBe(true);
  });

  it('is unreachable in a production build', () => {
    expect(autoPauseDisabled('?nopause', false)).toBe(false);
    expect(autoPauseDisabled('?nopause=1', false)).toBe(false);
  });

  it('does not match a parameter that merely contains the word', () => {
    expect(autoPauseDisabled('?nopauses', true)).toBe(false);
    expect(autoPauseDisabled('?autonopause', true)).toBe(false);
    expect(autoPauseDisabled('?x=nopause', true)).toBe(false);
  });
});
