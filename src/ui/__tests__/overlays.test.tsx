/// <reference types="jest" />
import './setup';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { confirmDialog } from '@web/stores/confirmDialog';
import { UiProvider } from '../UiHosts';
import { closeActionSheet, showActionSheet, showDialog, type ActionItem } from '../presenter';
import { Select } from '../Select';
import { dismissToast, toast, toastStore } from '../toast';

async function mountHosts() {
  await render(<UiProvider>{null}</UiProvider>);
}

afterEach(async () => {
  await act(async () => {
    closeActionSheet();
    dismissToast();
  });
});

describe('ActionSheet presenter', () => {
  it('runs the chosen item after the sheet closes and resolves with it', async () => {
    await mountHosts();
    const order: string[] = [];
    const del = jest.fn(() => order.push('handler'));
    let picked: Promise<ActionItem | null> = Promise.resolve(null);
    await act(async () => {
      picked = showActionSheet([{ label: 'Copy', icon: 'fa-copy' }, { label: 'Delete', danger: true, onSelect: del }], { title: 'Message' });
    });
    expect(screen.getByText('Message')).toBeTruthy();
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Delete' }));
    const item = await picked;
    order.push('resolved');
    expect(del).toHaveBeenCalledTimes(1);
    expect(item?.label).toBe('Delete');
    expect(order).toEqual(['handler', 'resolved']);
    // Closed.
    expect(screen.queryByText('Message')).toBeNull();
  });

  it("calls a web ContextMenuItem's onClick", async () => {
    await mountHosts();
    const onClick = jest.fn();
    await act(async () => {
      void showActionSheet([{ label: 'Copy user ID', icon: 'fa-copy', onClick }]);
    });
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Copy user ID' }));
    // Handlers run a frame after the sheet has closed.
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
  });

  it('ignores disabled items', async () => {
    await mountHosts();
    const onSelect = jest.fn();
    await act(async () => {
      void showActionSheet([{ label: 'Kick', disabled: true, onSelect }]);
    });
    const row = screen.getByRole('menuitem', { name: 'Kick' });
    expect(row).toBeDisabled();
    await fireEvent.press(row);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Kick' })).toBeTruthy();
  });

  it('opens a submenu page and comes back', async () => {
    await mountHosts();
    const move = jest.fn();
    let picked: Promise<ActionItem | null> = Promise.resolve(null);
    await act(async () => {
      picked = showActionSheet([
        { label: 'Mute' },
        { label: 'Move to', submenu: () => [{ section: 'Voice rooms' }, { label: 'Lounge', onSelect: move }] },
      ]);
    });
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Move to' }));
    expect(screen.getByText('Voice rooms')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Mute' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('menuitem', { name: 'Mute' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Move to' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Lounge' }));
    expect((await picked)?.label).toBe('Lounge');
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('a newer sheet replaces the open one, which resolves null', async () => {
    await mountHosts();
    let first: Promise<ActionItem | null> = Promise.resolve(null);
    await act(async () => {
      first = showActionSheet([{ label: 'One' }]);
    });
    await act(async () => {
      void showActionSheet([{ label: 'Two' }]);
    });
    await expect(first).resolves.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Two' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'One' })).toBeNull();
  });

  it('closeActionSheet resolves null', async () => {
    await mountHosts();
    let p: Promise<ActionItem | null> = Promise.resolve(null);
    await act(async () => {
      p = showActionSheet([{ label: 'One' }]);
    });
    await act(async () => closeActionSheet());
    await expect(p).resolves.toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'One' })).toBeNull();
  });
});

describe('Select', () => {
  it('opens the options with the current one checked and reports a new choice', async () => {
    const onChange = jest.fn();
    await render(
      <UiProvider>
        <Select
          label="Theme"
          value="dark"
          onValueChange={onChange}
          options={[
            { value: 'dark', label: 'Strafe Dark' },
            { value: 'light', label: 'Strafe Light' },
          ]}
        />
      </UiProvider>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Theme, Strafe Dark' }));
    expect(screen.getByRole('menuitem', { name: 'Strafe Dark' })).toBeSelected();
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Strafe Light' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('light'));
  });
});

describe('DialogHost', () => {
  it("renders the web's confirmDialog and resolves on the buttons", async () => {
    await mountHosts();
    let answer: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      answer = confirmDialog({ title: 'Delete message?', body: 'This cannot be undone.', tone: 'danger', confirmLabel: 'Delete' });
    });
    expect(screen.getByText('Delete message?')).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByText('Delete message?')).toBeNull();

    await act(async () => {
      answer = confirmDialog({ title: 'Leave space?' });
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await expect(answer).resolves.toBe(false);
  });

  it('queues showDialog requests', async () => {
    await mountHosts();
    let a: Promise<string | null> = Promise.resolve(null);
    let b: Promise<string | null> = Promise.resolve(null);
    await act(async () => {
      a = showDialog({ title: 'First', actions: [{ label: 'OK', value: 'a' }] });
      b = showDialog({ title: 'Second', actions: [{ label: 'Fine', value: 'b' }] });
    });
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.queryByText('Second')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'OK' }));
    await expect(a).resolves.toBe('a');
    expect(screen.getByText('Second')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Fine' }));
    await expect(b).resolves.toBe('b');
  });
});

describe('toast', () => {
  it('shows, replaces, updates in place and dismisses', async () => {
    await mountHosts();
    await act(async () => {
      toast('Copied');
    });
    expect(screen.getByText('Copied')).toBeTruthy();
    await act(async () => {
      toast.error('Could not send');
    });
    expect(screen.queryByText('Copied')).toBeNull();
    expect(screen.getByText('Could not send')).toBeTruthy();
    await act(async () => {
      toast({ id: 'upload', message: 'Uploading 1/3' });
    });
    await act(async () => {
      toast({ id: 'upload', message: 'Uploading 2/3' });
    });
    expect(toastStore.get()?.id).toBe('upload');
    expect(screen.getByText('Uploading 2/3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('toast'));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('runs its action and goes away on its own', async () => {
    jest.useFakeTimers();
    try {
      await mountHosts();
      const retry = jest.fn();
      await act(async () => {
        toast.error('Failed', { action: { label: 'Retry', onPress: retry } });
      });
      await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
      expect(retry).toHaveBeenCalled();
      expect(screen.queryByTestId('toast')).toBeNull();

      await act(async () => {
        toast('Saved');
      });
      expect(screen.getByText('Saved')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(3100);
      });
      expect(screen.queryByText('Saved')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('empty sheets', () => {
  it('resolves null without showing anything when no item applies', async () => {
    await mountHosts();
    let p: Promise<ActionItem | null> = Promise.resolve(null);
    await act(async () => {
      p = showActionSheet([false, null, 'separator', { section: 'Moderation' }]);
    });
    await expect(p).resolves.toBeNull();
    expect(screen.queryByText('Moderation')).toBeNull();
  });
});
