/**
 * ErrorBoundary: a render error remounts the children (a fresh mount reads the current state),
 * an error that keeps coming back stops at the "Something went wrong / Retry" state instead of
 * looping, and Retry starts over.
 */
import './setup';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ErrorBoundary, ERROR_BOUNDARY_MAX_RESETS } from '../ErrorBoundary';

/** How many more mounts of <Flaky> throw (from an effect, as the list's crash did). */
let failures = 0;
let mounts = 0;
function Flaky() {
  useEffect(() => {
    mounts += 1;
    if (failures > 0) {
      failures -= 1;
      throw new Error('index out of bounds, not enough layouts');
    }
  }, []);
  return <Text>panel</Text>;
}

let errors: ReturnType<typeof jest.spyOn>;
beforeEach(() => {
  failures = 0;
  mounts = 0;
  // React and the boundary both log the caught error; keep the output quiet.
  errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errors.mockRestore();
  jest.useRealTimers();
});

describe('ErrorBoundary', () => {
  test('renders its children when nothing fails', async () => {
    await render(
      <ErrorBoundary name="test">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText('panel')).toBeTruthy();
    expect(mounts).toBe(1);
  });

  test('an error remounts the children, which then render normally; it is logged with the boundary name', async () => {
    failures = 1;
    await render(
      <ErrorBoundary name="message-list">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText('panel')).toBeTruthy();
    expect(mounts).toBe(2);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('[message-list]'), 'index out of bounds, not enough layouts', expect.anything());
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
  });

  test('an error that keeps coming back stops at the fallback instead of looping; Retry starts over', async () => {
    failures = 100;
    await render(
      <ErrorBoundary name="members-panel">
        <Flaky />
      </ErrorBoundary>,
    );
    // The first mount plus the allowed remounts, then it gives up.
    expect(mounts).toBe(ERROR_BOUNDARY_MAX_RESETS + 1);
    expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByText('panel')).toBeNull();

    failures = 0;
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(screen.getByText('panel')).toBeTruthy();
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
  });

  test('errors spread out in time each get a fresh remount (only a burst counts as a loop)', async () => {
    jest.useFakeTimers();
    const view = await render(
      <ErrorBoundary name="nav-panel" maxResets={1} windowMs={1000}>
        <Flaky key="a" />
      </ErrorBoundary>,
    );
    for (const key of ['b', 'c', 'd']) {
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      failures = 1;
      // A new child key mounts a fresh <Flaky>, which fails once.
      await view.rerender(
        <ErrorBoundary name="nav-panel" maxResets={1} windowMs={1000}>
          <Flaky key={key} />
        </ErrorBoundary>,
      );
      expect(screen.getByText('panel')).toBeTruthy();
    }
    // Each new child failed once and was remounted: 1 + 3 x 2 mounts.
    expect(mounts).toBe(7);
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
  });
});
