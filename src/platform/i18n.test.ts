/**
 * The layout direction saved for the next launch follows the last language chosen, whatever
 * direction this run launched with (I18nManager.isRTL, read once at start-up).
 */
import { I18nManager } from 'react-native';
import { syncLayoutDirection } from './i18n';

describe('layout direction', () => {
  it('saves the direction of the last language chosen, even when it is the one this run started in', () => {
    // This run launched left-to-right (the jest native module's isRTL).
    expect(I18nManager.isRTL).toBe(false);
    const force = jest.spyOn(I18nManager, 'forceRTL');
    const allow = jest.spyOn(I18nManager, 'allowRTL');

    expect(syncLayoutDirection('ar')).toBe(true);
    expect(force).toHaveBeenLastCalledWith(true);

    // English again before any restart ("Later" in the restart dialog): the next launch must
    // not come up mirrored, though this run never was.
    expect(syncLayoutDirection('en')).toBe(false);
    expect(force).toHaveBeenLastCalledWith(false);
    expect(allow).toHaveBeenLastCalledWith(false);
  });
});
