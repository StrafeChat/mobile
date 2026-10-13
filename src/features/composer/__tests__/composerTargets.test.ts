/**
 * Whether the message being edited was deleted or only left the loaded window: an id inside
 * the window's range is gone; one beyond an end only when nothing more is that way. Anything
 * uncertain keeps the edit (and what was typed).
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { beforeEach, describe, expect, test } from '@jest/globals';
import { setRooms } from '@web/stores/rooms';
import { setMessages } from '@web/stores/messages';
import { message, pm, resetStores, user } from '@/data/testing/fixtures';
import { editTargetView, windowCovers } from '../hooks/useComposerTargets';

function load(ids: string[], flags: { older?: boolean; newer?: boolean } = {}) {
  setMessages('byRoom', 'r', ids.map((id) => message('r', id, '1')));
  setMessages('hasMoreOlder', 'r', flags.older ?? true);
  setMessages('hasMoreNewer', 'r', flags.newer ?? false);
}

beforeEach(() => {
  resetStores();
  setRooms({ rooms: [pm('r', user('1'), { last_message_id: '30' })] });
});

describe('the edited message', () => {
  test('loaded: neither missing nor deleted', () => {
    load(['10', '20', '30']);
    expect(editTargetView('r', '20')).toMatchObject({ loaded: true, deleted: false });
  });

  test('missing from between loaded messages: deleted', () => {
    load(['10', '30']);
    expect(editTargetView('r', '20')).toMatchObject({ loaded: false, deleted: true });
  });

  test('older than the window: deleted only when the window reaches the start of the room', () => {
    load(['20', '30']);
    expect(windowCovers('r', '10')).toBe(false);
    load(['20', '30'], { older: false });
    expect(windowCovers('r', '10')).toBe(true);
  });

  test('newer than the window: deleted only past the room\'s newest message, at the live end', () => {
    // A jump to older history: the edited message is further down.
    load(['10', '11'], { newer: true });
    expect(windowCovers('r', '20')).toBe(false);
    // "Jump to present" clears hasMoreNewer before the tail arrives; the room's newest
    // message (30) says 20 can still exist.
    load(['10', '11'], { newer: false });
    expect(windowCovers('r', '20')).toBe(false);
    // Past the newest message the room has: gone.
    load(['10', '20'], { newer: false });
    expect(windowCovers('r', '31')).toBe(true);
  });

  test('nothing loaded, or only sends in flight: unknown, so kept', () => {
    load([]);
    expect(windowCovers('r', '20')).toBe(false);
    load(['temp-1']);
    expect(windowCovers('r', '20')).toBe(false);
  });
});
