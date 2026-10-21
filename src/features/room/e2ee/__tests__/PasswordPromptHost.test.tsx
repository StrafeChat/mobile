/**
 * The account-password prompt the key-backup flow raises (the web's stores/passwordPrompt,
 * which stores/e2eeBackup awaits before it creates or deletes a backup version): the answer
 * resolves the flow, a wrong password comes back with the error under the field, closing the
 * sheet is "leave things as they are", and a sheet still sliding away after an answer never
 * cancels the prompt that replaced it.
 */
import '../../__tests__/roomTestSetup';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { t } from '@web/i18n/t';
import {
  cancelPasswordPrompt,
  passwordPromptState,
  PasswordPromptCancelled,
  promptPassword,
  setPasswordPromptError,
} from '@web/stores/passwordPrompt';
import { resetStores } from '@/data/testing/fixtures';

const { PasswordPromptHost } = require('../PasswordPromptHost') as typeof import('../PasswordPromptHost');

const OPTIONS = { title: 'Confirm your password', description: 'Needed to change the backup.', confirmLabel: 'Continue' };

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
});

afterEach(async () => {
  await act(async () => {
    cancelPasswordPrompt();
  });
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

function field() {
  return screen.getByLabelText(t('settings.security.passwordPromptLabel'));
}

describe('the password prompt', () => {
  test('the answer resolves the flow and closes the sheet', async () => {
    await render(<PasswordPromptHost />);
    let answer: Promise<string> = Promise.resolve('');
    await act(async () => {
      answer = promptPassword(OPTIONS);
    });
    expect(screen.getByText('Confirm your password')).toBeTruthy();
    expect(screen.getByText('Needed to change the backup.')).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(field(), 'hunter2');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    });
    await expect(answer).resolves.toBe('hunter2');
    expect(passwordPromptState.pending).toBeNull();
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(screen.queryByText('Confirm your password')).toBeNull();
  });

  test('asked again after a wrong password, with the error under the field', async () => {
    await render(<PasswordPromptHost />);
    await act(async () => {
      setPasswordPromptError('That password is not correct.');
      void promptPassword({ ...OPTIONS, retainSubmitError: true }).catch(() => undefined);
    });
    expect(screen.getByText('That password is not correct.')).toBeTruthy();
    // Typing clears it, as any field error.
    await act(async () => {
      fireEvent.changeText(field(), 'x');
    });
    expect(screen.queryByText('That password is not correct.')).toBeNull();
  });

  test('closing the sheet cancels: the flow leaves things as they are', async () => {
    await render(<PasswordPromptHost />);
    let failure: unknown;
    await act(async () => {
      promptPassword(OPTIONS).catch((e: unknown) => (failure = e));
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: t('common.close') }));
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(failure).toBeInstanceOf(PasswordPromptCancelled);
    expect(passwordPromptState.pending).toBeNull();
  });

  test('a sheet closing after an answer does not cancel the prompt raised next', async () => {
    await render(<PasswordPromptHost />);
    let first: Promise<string> = Promise.resolve('');
    await act(async () => {
      first = promptPassword(OPTIONS);
    });
    await act(async () => {
      fireEvent.changeText(field(), 'wrong');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    });
    await expect(first).resolves.toBe('wrong');
    // The server said no: the flow asks again while the first sheet is still going away.
    let failure: unknown;
    await act(async () => {
      setPasswordPromptError('That password is not correct.');
      promptPassword({ ...OPTIONS, retainSubmitError: true }).catch((e: unknown) => (failure = e));
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(failure).toBeUndefined();
    expect(passwordPromptState.pending).not.toBeNull();
    expect(screen.getByText('That password is not correct.')).toBeTruthy();
  });
});
