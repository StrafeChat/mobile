import { describe, expect, it } from '@jest/globals';
import '@/ui/__tests__/setup';
import { appStorage } from '@/platform/storage';
import { setSwipeToReplyEnabled, swipeToReplyEnabled } from '../preferences';

describe('swipe to reply preference', () => {
  it('is off by default, so a leftward swipe opens the member list', () => {
    expect(swipeToReplyEnabled()).toBe(false);
  });

  it('persists on this device when turned on and off', () => {
    setSwipeToReplyEnabled(true);
    expect(swipeToReplyEnabled()).toBe(true);
    expect(appStorage.getBoolean('chat.swipeToReply')).toBe(true);
    setSwipeToReplyEnabled(false);
    expect(swipeToReplyEnabled()).toBe(false);
    expect(appStorage.getBoolean('chat.swipeToReply')).toBe(false);
  });
});
