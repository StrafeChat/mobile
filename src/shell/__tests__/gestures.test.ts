/**
 * The swipe shell's arithmetic: where a drag puts the panels, what a release commits to, and
 * which touches the right-edge zone (always "open the member list") takes.
 */
import { describe, expect, test } from '@jest/globals';
import { EDGE_ZONE_PX, dragPosition, edgeZoneAccepts, releasePlan } from '../gestures';

const geo = { width: 400, drawerWidth: 344 };
const rails = { progress: 0, drawer: 0, canMembers: true };
const chat = { progress: 1, drawer: 0, canMembers: true };
const members = { progress: 1, drawer: 1, canMembers: true };

describe('dragging', () => {
  test('from the rails, left brings the conversation over, clamped', () => {
    expect(dragPosition(rails, -100, geo)).toEqual({ progress: 0.25, drawer: 0 });
    expect(dragPosition(rails, -800, geo).progress).toBe(1);
    expect(dragPosition(rails, 50, geo).progress).toBe(0);
  });

  test('from the conversation, left pulls the members in (only when it has some), right uncovers the rails', () => {
    expect(dragPosition(chat, -172, geo)).toEqual({ progress: 1, drawer: 0.5 });
    expect(dragPosition({ ...chat, canMembers: false }, -172, geo)).toEqual({ progress: 1, drawer: 0 });
    expect(dragPosition(chat, 100, geo)).toEqual({ progress: 0.75, drawer: 0 });
  });

  test('with the members open, right closes them', () => {
    expect(dragPosition(members, 172, geo).drawer).toBe(0.5);
    expect(dragPosition(members, -50, geo).drawer).toBe(1);
  });
});

describe('releasing', () => {
  test('commits past 28% (at most 140 px) or on a flick, else settles back', () => {
    expect(releasePlan(rails, -111, 0, geo)).toEqual({ progress: 0, drawer: 0, action: null });
    expect(releasePlan(rails, -113, 0, geo)).toEqual({ progress: 1, drawer: 0, action: 'content' });
    expect(releasePlan(rails, -20, -600, geo).action).toBe('content');
    expect(releasePlan(chat, 141, 0, { width: 900, drawerWidth: 360 }).action).toBe('nav');
    expect(releasePlan(chat, 30, 0, geo)).toEqual({ progress: 1, drawer: 0, action: null });
  });

  test('a flick only counts in the direction the finger went', () => {
    // Dragged left, flicked back right at the end: not a swipe back to the rails.
    expect(releasePlan({ ...chat, canMembers: false }, -20, 900, geo).action).toBeNull();
    // Dragged right, flicked left: the conversation does not come over.
    expect(releasePlan(rails, 20, -900, geo).action).toBeNull();
  });

  test('members open and close on their own threshold', () => {
    expect(releasePlan(chat, -100, 0, geo)).toEqual({ progress: 1, drawer: 1, action: 'membersOpen' });
    expect(releasePlan(chat, -40, 0, geo)).toEqual({ progress: 1, drawer: 0, action: 'membersClosed' });
    expect(releasePlan(members, 100, 0, geo)).toEqual({ progress: 1, drawer: 0, action: 'membersClosed' });
    expect(releasePlan(members, 20, 0, geo)).toEqual({ progress: 1, drawer: 1, action: 'membersOpen' });
  });
});

describe('the right-edge zone', () => {
  test('takes touches in the rightmost strip of a conversation with members', () => {
    expect(edgeZoneAccepts(400 - EDGE_ZONE_PX + 1, 400, chat)).toBe(true);
    expect(edgeZoneAccepts(399, 400, chat)).toBe(true);
    expect(edgeZoneAccepts(200, 400, chat)).toBe(false);
  });

  test('stays out of the way on the rails, with the members open, or without a member list', () => {
    expect(edgeZoneAccepts(399, 400, rails)).toBe(false);
    expect(edgeZoneAccepts(399, 400, members)).toBe(false);
    expect(edgeZoneAccepts(399, 400, { ...chat, canMembers: false })).toBe(false);
  });

  test('is wider than the system back-gesture strip (24 dp)', () => {
    expect(EDGE_ZONE_PX).toBeGreaterThanOrEqual(40);
  });
});
