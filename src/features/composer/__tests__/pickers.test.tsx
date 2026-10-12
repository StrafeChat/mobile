/**
 * The expression pickers: the emoji grid (sections, pick, recent list, skin tone), its panel
 * layout (the conversation's space first, the category bar, backspace), the composer's
 * expression panel (tabs, GIF tab mounted on demand), the reaction sheet, and the GIF tab's
 * "not configured" state when the instance has no GIF API key.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import i18next from 'i18next';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { setCustomEmojis } from '@web/stores/customEmojis';
import { setSpaces } from '@web/stores/spaces';
import { resetStores, space } from '@/data/testing/fixtures';
import { EmojiPicker } from '../components/EmojiPicker';
import { GifPicker } from '../components/GifPicker';
import { Gesture } from 'react-native-gesture-handler';
import { EmojiPickerSheet } from '../components/EmojiPickerSheet';
import { ExpressionPanel } from '../panel/ExpressionPanel';
import type { ExpressionPanel as ExpressionPanelController } from '../panel/useExpressionPanel';
import { RECENT_KEY } from '../logic/emojiRecent';
import composerEn from '@/i18n/areas/composer/en';

jest.mock('expo-image', () => {
  const React = require('react');
  const RN = require('react-native');
  return { Image: () => React.createElement(RN.View) };
});
// The shell (reached through @/ui) is not under test here; keep its navigation imports out.
jest.mock('@/shell/SwipeShell', () => ({
  HorizontalGestureOwner: ({ children }: { children: unknown }) => children,
  useShellGesture: () => ({ pan: null, progress: null }),
}));

// The composer area's own strings, so assertions read as users hear them.
i18next.addResourceBundle('en', 'translation', { mobile: { composer: composerEn } }, true, true);

jest.mock('@web/stores/externalLink', () => ({ requestOpenExternalLink: () => undefined }));

// The setup's bottom-sheet stand-in has no scrollable creator; the plain list is enough here.
Object.assign(jest.requireMock<object>('@gorhom/bottom-sheet'), { useBottomSheetScrollableCreator: () => undefined });

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  globalThis.localStorage.removeItem(RECENT_KEY);
  setSpaces('spaces', [space('s1', [], { name: 'Blob Space' })]);
  setCustomEmojis({
    bySpaceId: { s1: [{ id: 'e1', space_id: 's1', name: 'blobwave', url: 'https://cdn/e1.png', animated: false }] },
    byId: { e1: { id: 'e1', space_id: 's1', name: 'blobwave', url: 'https://cdn/e1.png', animated: false } },
    missing: {},
    loaded: true,
  });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('EmojiPicker', () => {
  test('lists a space’s custom emoji and remembers a pick as recent', async () => {
    const onPick = jest.fn();
    await render(<EmojiPicker onPick={onPick} />);
    // The grid lays out once its width is known.
    await act(async () => {
      fireEvent(screen.getByTestId('emoji-grid'), 'layout', {
        nativeEvent: { layout: { width: 360, height: 400, x: 0, y: 0 } },
      });
    });
    expect(screen.getByRole('tab', { name: 'Blob Space' })).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('emoji-search'), 'blob');
    await fireEvent.press(await screen.findByTestId('emoji-c:e1'));
    expect(onPick).toHaveBeenCalledWith({ custom: expect.objectContaining({ id: 'e1', name: 'blobwave' }) });
    expect(JSON.parse(globalThis.localStorage.getItem(RECENT_KEY)!)).toEqual(['c:e1']);
  });

  test('a space restriction hides other spaces’ emoji', async () => {
    await render(<EmojiPicker onPick={() => undefined} customEmojiSpaceId="other" />);
    expect(screen.queryByRole('tab', { name: 'Blob Space' })).toBeNull();
  });
});

describe('GifPicker', () => {
  test('says the provider is not set up when the instance has no key', async () => {
    await render(<GifPicker onPick={() => undefined} />);
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.getByText('GIPHY isn’t set up')).toBeTruthy();
  });
});

function fakePanel(over: Partial<ExpressionPanelController> = {}): ExpressionPanelController {
  return {
    open: true,
    tab: 'emoji',
    expanded: false,
    setTab: jest.fn(),
    openPanel: jest.fn(),
    close: jest.fn(),
    showKeyboard: jest.fn(),
    onInputFocus: jest.fn(),
    onSearchFocus: jest.fn(),
    onSearchBlur: jest.fn(),
    toggleExpanded: jest.fn(),
    handleGesture: Gesture.Pan(),
    spacerStyle: { height: 300 },
    panelStyle: { height: 300 },
    contentStyle: { height: 300 },
    bottomPadStyle: { height: 0 },
    ...over,
  } as ExpressionPanelController;
}

describe('ExpressionPanel', () => {
  const props = { onPickEmoji: () => undefined, onPickGif: () => undefined, onBackspace: () => undefined, gifAllowed: true };

  test('opens on the emoji tab; the GIF tab mounts (and fetches) only when chosen', async () => {
    const view = await render(<ExpressionPanel panel={fakePanel()} {...props} />);
    expect(screen.getByTestId('emoji-search').props.placeholder).toBe('Find the perfect emoji');
    expect(screen.queryByTestId('gif-search')).toBeNull();
    await view.rerender(<ExpressionPanel panel={fakePanel({ tab: 'gif' })} {...props} />);
    expect(screen.getByTestId('gif-search')).toBeTruthy();
  });

  test('editing hides the GIF tab', async () => {
    await render(<ExpressionPanel panel={fakePanel({ tab: 'gif' })} {...props} gifAllowed={false} />);
    expect(screen.queryByTestId('expression-tabs')).toBeNull();
    expect(screen.getByTestId('emoji-search')).toBeTruthy();
  });

  test('the backspace key, the search focus and the handle reach the composer', async () => {
    const onBackspace = jest.fn();
    const panel = fakePanel();
    await render(<ExpressionPanel panel={panel} {...props} onBackspace={onBackspace} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(onBackspace).toHaveBeenCalledTimes(1);
    await fireEvent(screen.getByTestId('emoji-search'), 'focus');
    expect(panel.onSearchFocus).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Expand emoji and GIFs' }));
    expect(panel.toggleExpanded).toHaveBeenCalled();
  });
});

describe('EmojiPicker panel layout', () => {
  test('the conversation’s space comes first and the bar jumps to a section', async () => {
    setSpaces('spaces', [space('s1', [], { name: 'Blob Space' }), space('s2', [], { name: 'Home Space' })]);
    setCustomEmojis({
      bySpaceId: {
        s1: [{ id: 'e1', space_id: 's1', name: 'blobwave', url: 'https://cdn/e1.png', animated: false }],
        s2: [{ id: 'e2', space_id: 's2', name: 'homey', url: 'https://cdn/e2.png', animated: false }],
      },
      byId: {
        e1: { id: 'e1', space_id: 's1', name: 'blobwave', url: 'https://cdn/e1.png', animated: false },
        e2: { id: 'e2', space_id: 's2', name: 'homey', url: 'https://cdn/e2.png', animated: false },
      },
      missing: {},
      loaded: true,
    });
    const onPick = jest.fn();
    await render(<EmojiPicker variant="panel" currentSpaceId="s2" onPick={onPick} onBackspace={() => undefined} />);
    await act(async () => {
      fireEvent(screen.getByTestId('emoji-grid'), 'layout', { nativeEvent: { layout: { width: 360, height: 400, x: 0, y: 0 } } });
    });
    const tabs = screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel as string);
    expect(tabs.slice(0, 2)).toEqual(['Home Space', 'Blob Space']);
    await fireEvent.press(screen.getByRole('tab', { name: 'Blob Space' }));
    expect(screen.getByRole('tab', { name: 'Blob Space' }).props.accessibilityState).toMatchObject({ selected: true });
    // A pick in the panel is remembered without reshuffling the grid under the finger.
    await fireEvent.press(await screen.findByTestId('emoji-c:e2'));
    expect(onPick).toHaveBeenCalledWith({ custom: expect.objectContaining({ id: 'e2' }) });
    expect(JSON.parse(globalThis.localStorage.getItem(RECENT_KEY)!)).toEqual(['c:e2']);
    expect(screen.queryByRole('tab', { name: 'Frequently used' })).toBeNull();
  });
});

describe('EmojiPickerSheet', () => {
  test('keeps the sheet layout for reactions: no backspace key, the plain search', async () => {
    await render(<EmojiPickerSheet open onClose={() => undefined} onPick={() => undefined} title="Add reaction" />);
    expect(screen.getByTestId('emoji-search').props.placeholder).toBe('Search emoji');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
