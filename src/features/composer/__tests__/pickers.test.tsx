/**
 * The expression pickers: the emoji grid (sections, pick, recent list, skin tone) and the GIF
 * tab's "not configured" state when the instance has no GIF API key.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { setCustomEmojis } from '@web/stores/customEmojis';
import { setSpaces } from '@web/stores/spaces';
import { resetStores, space } from '@/data/testing/fixtures';
import { EmojiPicker } from '../components/EmojiPicker';
import { GifPicker } from '../components/GifPicker';
import { ExpressionSheet } from '../components/ExpressionSheet';
import { RECENT_KEY } from '../logic/emojiRecent';

jest.mock('expo-image', () => {
  const React = require('react');
  const RN = require('react-native');
  return { Image: () => React.createElement(RN.View) };
});
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

describe('ExpressionSheet', () => {
  const props = { onClose: () => undefined, onTabChange: () => undefined, onPickEmoji: () => undefined, onPickGif: () => undefined };

  test('opens on the emoji tab; the GIF tab mounts (and fetches) only when chosen', async () => {
    const view = await render(<ExpressionSheet open tab="emoji" {...props} />);
    expect(screen.getByTestId('emoji-search')).toBeTruthy();
    expect(screen.queryByTestId('gif-search')).toBeNull();
    await view.rerender(<ExpressionSheet open tab="gif" {...props} />);
    expect(screen.getByTestId('gif-search')).toBeTruthy();
  });

  test('editing hides the GIF tab', async () => {
    await render(<ExpressionSheet open tab="gif" gifAllowed={false} {...props} />);
    expect(screen.queryByTestId('expression-tabs')).toBeNull();
    expect(screen.getByTestId('emoji-search')).toBeTruthy();
  });
});
