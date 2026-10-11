/**
 * Accounts on this device (the sign-in list and the You panel's switcher) and the language
 * switcher's restart offer.
 */
import './authTestSetup';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import i18next from 'i18next';
import webEn from '@web/i18n/locales/en';
import { settleConfirmDialog, confirmDialogState } from '@web/stores/confirmDialog';
import authEn from '@/i18n/areas/auth/en';
import { actionSheetStore, dialogStore, settleActionSheet, settleDialog, type ActionItem } from '@/ui';
import { AccountSwitcherSheet, SavedAccountsList, openAccountSwitcher } from '../accounts';
import { changeLanguage, needsDirectionRestart } from '../components/LanguageButton';

const session = jest.requireMock('@/platform/session') as Record<string, jest.Mock> & {
  mockSetAccounts: (a: unknown[]) => void;
  mockSetActiveId: (id: string | null) => void;
};
const reload = jest.requireMock('@/platform/reload') as { reloadApp: jest.Mock };

const inst = (domain: string) => ({ domain, apiUrl: `https://${domain}/api`, stargateUrl: `wss://${domain}/gateway/events` });
const ALICE = { id: 'a.org:1', instance: inst('a.org'), token: 't1', userId: '1', username: 'alice', displayName: 'Alice', addedAt: 1, lastUsedAt: 5 };
const BOB = { id: 'b.org:2', instance: inst('b.org'), token: 't2', userId: '2', username: 'bob', displayName: '', addedAt: 2, lastUsedAt: 3 };

beforeEach(() => {
  jest.clearAllMocks();
  session.mockSetAccounts([ALICE, BOB]);
  session.mockSetActiveId(null);
  actionSheetStore.set(null);
});

describe('saved accounts on the sign-in screen', () => {
  test('lists them; a tap switches, the bin removes after a confirm', async () => {
    await render(<SavedAccountsList />);
    expect(screen.getByText('Alice')).toBeTruthy();
    // No display name: the username stands in.
    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.getByText('@bob · b.org')).toBeTruthy();

    await fireEvent.press(screen.getByText('Alice'));
    expect(session.switchAccount).toHaveBeenCalledWith('a.org:1');

    await fireEvent.press(screen.getByTestId('account-remove-b.org:2'));
    expect(confirmDialogState.pending?.options.body).toBe('Remove bob on b.org from this device? You can sign in again any time.');
    await act(async () => settleConfirmDialog(true));
    expect(session.forgetAccount).toHaveBeenCalledWith('b.org:2');
  });

  test('nothing to show without accounts', async () => {
    session.mockSetAccounts([]);
    await render(<SavedAccountsList />);
    expect(screen.queryByTestId('saved-accounts')).toBeNull();
  });
});

describe('account switcher', () => {
  test('openAccountSwitcher() opens the mounted sheet; the active account is checked', async () => {
    session.mockSetActiveId('a.org:1');
    await render(<AccountSwitcherSheet />);
    expect(screen.queryByText(webEn.desktop.accounts.switch)).toBeNull();
    await act(async () => openAccountSwitcher());
    expect(screen.getByText(webEn.desktop.accounts.switch)).toBeTruthy();
    expect(screen.getByLabelText(authEn.activeAccount)).toBeTruthy();
    await fireEvent.press(screen.getByText('bob'));
    expect(session.switchAccount).toHaveBeenCalledWith('b.org:2');
  });

  test('"Add an account" keeps this one and signs in to another', async () => {
    await render(<AccountSwitcherSheet open onClose={() => undefined} />);
    await fireEvent.press(screen.getByTestId('account-add'));
    expect(session.addAccount).toHaveBeenCalled();
  });

  test('long-press offers sign out on the active account and remove on any', async () => {
    session.mockSetActiveId('a.org:1');
    await render(<AccountSwitcherSheet open onClose={() => undefined} />);
    await fireEvent(screen.getByTestId('account-a.org:1'), 'longPress');
    const req = actionSheetStore.get()!;
    const labels = req.entries.filter((e): e is ActionItem => !!e && typeof e === 'object' && 'label' in e).map((e) => e.label);
    expect(labels).toEqual([webEn.desktop.accounts.signOut, webEn.desktop.accounts.remove]);
    await act(async () => settleActionSheet(req.id, null));
  });

  test('without a mounted sheet it falls back to the shared action sheet', async () => {
    openAccountSwitcher();
    const req = actionSheetStore.get();
    expect(req?.options.title).toBe(webEn.desktop.accounts.switch);
    const labels = req!.entries.filter((e): e is ActionItem => !!e && typeof e === 'object' && 'label' in e).map((e) => e.label);
    expect(labels).toEqual(['Alice', 'bob', webEn.desktop.accounts.add]);
    settleActionSheet(req!.id, null);
  });
});

describe('language', () => {
  afterEach(async () => {
    await i18next.changeLanguage('en');
  });

  test('only a change of direction needs a restart', () => {
    expect(needsDirectionRestart('ar', false)).toBe(true);
    expect(needsDirectionRestart('es', false)).toBe(false);
    expect(needsDirectionRestart('en', true)).toBe(true);
  });

  test('switching into Arabic changes the text at once and offers the restart', async () => {
    const done = changeLanguage('ar');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(i18next.language).toBe('ar');
    const [dialog] = dialogStore.get();
    expect(dialog).toBeDefined();
    settleDialog(dialog!.id, true);
    await done;
    expect(reload.reloadApp).toHaveBeenCalled();
  });

  test('a same-direction language needs no restart', async () => {
    await changeLanguage('es');
    expect(i18next.language).toBe('es');
    expect(dialogStore.get()).toHaveLength(0);
    expect(reload.reloadApp).not.toHaveBeenCalled();
  });
});
