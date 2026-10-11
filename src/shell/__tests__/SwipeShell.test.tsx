/**
 * The shell component: Android back belongs to it only while it is the screen in front, the
 * keyboard goes away with the conversation, crossing the tablet breakpoint restyles the panels
 * without remounting them, and the member drawer keeps to the physical right edge.
 */
import '../../ui/__tests__/setup';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { useEffect } from 'react';
import { BackHandler, Keyboard, StyleSheet, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { closeView, openNav, openRoom, setMembersAvailable, setMembersOpen, shell } from '../state';
import { SwipeShell, drawerEdgeStyle, handleShellBack } from '../SwipeShell';

let mockFocused = true;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));

let mockWidth = 400;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 800, scale: 2, fontScale: 1 }),
}));

const life = { mounts: 0, unmounts: 0 };
function Probe({ label }: { label: string }) {
  useEffect(() => {
    life.mounts += 1;
    return () => {
      life.unmounts += 1;
    };
  }, []);
  return <Text>{label}</Text>;
}

function Shell() {
  return <SwipeShell nav={<Text>rails</Text>} content={<Probe label="chat" />} members={<Text>people</Text>} />;
}

type BackListener = () => boolean | null | undefined;
let listeners: { fn: BackListener; remove: jest.Mock }[] = [];

beforeEach(() => {
  mockFocused = true;
  mockWidth = 400;
  life.mounts = 0;
  life.unmounts = 0;
  listeners = [];
  closeView();
  setMembersAvailable(false);
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_type, fn) => {
    const entry = { fn: fn as BackListener, remove: jest.fn() };
    entry.remove.mockImplementation(() => {
      listeners = listeners.filter((l) => l !== entry);
    });
    listeners.push(entry);
    return { remove: entry.remove as () => void };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Android back', () => {
  test('members, then the conversation, then the rails; then the system (leave the app)', () => {
    openRoom('r1', null);
    setMembersAvailable(true);
    setMembersOpen(true);
    expect(handleShellBack()).toBe(true);
    expect(shell.membersOpen()).toBe(false);
    expect(shell.panel()).toBe('content');
    expect(handleShellBack()).toBe(true);
    expect(shell.panel()).toBe('nav');
    expect(handleShellBack()).toBe(false);
  });

  test('is only listened for while the shell is the screen in front', async () => {
    openRoom('r1', null);
    const view = await render(<Shell />);
    expect(listeners).toHaveLength(1);
    // A screen pushed over the shell: its back must reach the navigator, not move the shell.
    mockFocused = false;
    await view.rerender(<Shell />);
    expect(listeners).toHaveLength(0);
    expect(shell.panel()).toBe('content');
    mockFocused = true;
    await view.rerender(<Shell />);
    expect(listeners).toHaveLength(1);
    let handled: unknown;
    await act(async () => {
      handled = listeners[0]!.fn();
    });
    expect(handled).toBe(true);
    expect(shell.panel()).toBe('nav');
  });

  test('is not taken on a tablet, where nothing is hidden', async () => {
    mockWidth = 1000;
    await render(<Shell />);
    expect(listeners).toHaveLength(0);
  });
});

test('the keyboard goes away when the conversation is swiped or covered', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  openRoom('r1', null);
  setMembersAvailable(true);
  await render(<Shell />);
  expect(dismiss).not.toHaveBeenCalled();
  await act(async () => setMembersOpen(true));
  expect(dismiss).toHaveBeenCalledTimes(1);
  await act(async () => setMembersOpen(false));
  await act(async () => openNav());
  expect(dismiss).toHaveBeenCalledTimes(2);
});

test('crossing the tablet breakpoint keeps the panels mounted', async () => {
  openRoom('r1', null);
  const view = await render(<Shell />);
  expect(life).toEqual({ mounts: 1, unmounts: 0 });
  mockWidth = 1000; // unfolded / rotated to tablet width
  await view.rerender(<Shell />);
  mockWidth = 400;
  await view.rerender(<Shell />);
  expect(life).toEqual({ mounts: 1, unmounts: 0 });
  expect(screen.getByText('chat')).toBeTruthy();
});

describe('member list', () => {
  test("a tablet's open column survives switching between rooms", async () => {
    mockWidth = 1000;
    openRoom('r1', null);
    setMembersAvailable(true);
    await render(<Shell />);
    await act(async () => setMembersOpen(true));
    // The room view hands over: the old one clears membersAvailable, the next sets it again.
    await act(async () => setMembersAvailable(false));
    await act(async () => setMembersAvailable(true));
    expect(shell.membersOpen()).toBe(true);
  });

  test('a tablet shows it as a column only while open', async () => {
    mockWidth = 1000;
    openRoom('r1', null);
    setMembersAvailable(true);
    await render(<Shell />);
    expect(StyleSheet.flatten(screen.getByTestId('shell-members', { includeHiddenElements: true }).props.style).display).toBe('none');
    await act(async () => setMembersOpen(true));
    expect(StyleSheet.flatten(screen.getByTestId('shell-members', { includeHiddenElements: true }).props.style).display).not.toBe('none');
  });

  test('the phone drawer sits on the physical right edge in both directions', () => {
    // Right-to-left: `end` would be the left edge (and `right` is swapped to the left too).
    expect(drawerEdgeStyle(false)).toMatchObject({ end: 0 });
    expect(drawerEdgeStyle(false)).not.toHaveProperty('right');
    expect(drawerEdgeStyle(true)).toMatchObject({ start: 0 });
    expect(drawerEdgeStyle(true)).not.toHaveProperty('end');
  });
});
