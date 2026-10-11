/**
 * The swipe shell's gesture arithmetic, as plain worklets so the rules are testable without a
 * device: where the panels sit while a finger drags, what a release commits to, and which
 * touches the right-edge zone takes.
 *
 * The thresholds are the web client's (src/lib/mobileSwipe.ts): 12 px decides a swipe, a
 * release commits past 28 % of the panel (at most 140 px) or on a flick of 0.45 px/ms. The web
 * measures a flick as the drag's average speed, so it always points the way the finger went;
 * the native velocity is the instantaneous one, so a flick here also has to agree with the
 * drag's direction (dragging left, then flicking back right, is not a swipe to the right).
 *
 * The panels are physical, not mirrored in right-to-left layouts: the conversation comes in
 * from the right and the member list sits on the right edge in every language, because the
 * conversation's own gestures (swipe a message left to reply) assume a rightward swipe is
 * always "back to the rooms".
 */

/** Movement before deciding a gesture is a horizontal swipe rather than a scroll. */
export const DECIDE_PX = 12;
/** Fraction of a panel that has to be dragged for the swipe to commit on release. */
export const COMMIT_FRACTION = 0.28;
export const COMMIT_MAX_PX = 140;
/** A quick flick commits even when it did not travel far (px/s; the web's 0.45 px/ms). */
export const FLICK_VELOCITY = 450;
/**
 * The right-edge strip of a conversation where a leftward drag always opens the member list,
 * whatever is under the finger (a message's swipe-to-reply above all). Wider than Android's
 * gesture-navigation back zone (24 dp by default), which takes the outermost strip for itself.
 */
export const EDGE_ZONE_PX = 44;
/**
 * The edge drag decides a little sooner than anything under it (a message's swipe-to-reply
 * waits for 14 px), so it is the one that activates and cancels the rest.
 */
export const EDGE_ACTIVATE_PX = 10;

export interface DragStart {
  /** 0 = rails in front, 1 = conversation in front. */
  progress: number;
  /** 0 = member list closed, 1 = open. */
  drawer: number;
  /** The open conversation has a member list. */
  canMembers: boolean;
}

export interface ShellGeometry {
  /** The pager's width (one panel). */
  width: number;
  drawerWidth: number;
}

export type ReleaseAction = 'nav' | 'content' | 'membersOpen' | 'membersClosed' | null;

export interface ReleasePlan {
  progress: 0 | 1;
  drawer: 0 | 1;
  /** The shell state to commit (null: nothing changes, the panels settle back). */
  action: ReleaseAction;
}

function clamp01(v: number): number {
  'worklet';
  return Math.min(1, Math.max(0, v));
}

/** Where the panels sit while the finger is `dx` px from where the drag started. */
export function dragPosition(start: DragStart, dx: number, geo: ShellGeometry): { progress: number; drawer: number } {
  'worklet';
  if (start.drawer > 0.5) {
    // Members open: dragging right closes it.
    return { progress: start.progress, drawer: clamp01(1 - dx / geo.drawerWidth) };
  }
  if (start.progress > 0.5) {
    // Conversation in front: left pulls the member list in, right uncovers the rails.
    if (dx < 0) return { progress: 1, drawer: start.canMembers ? clamp01(-dx / geo.drawerWidth) : 0 };
    return { progress: clamp01(1 - dx / geo.width), drawer: 0 };
  }
  // Rails in front: dragging left brings the conversation over.
  return { progress: clamp01(-dx / geo.width), drawer: 0 };
}

/** What letting go after `dx` px at `vx` px/s commits to. */
export function releasePlan(start: DragStart, dx: number, vx: number, geo: ShellGeometry): ReleasePlan {
  'worklet';
  const commit = Math.min(geo.width * COMMIT_FRACTION, COMMIT_MAX_PX);
  const drawerCommit = Math.min(geo.drawerWidth * COMMIT_FRACTION, COMMIT_MAX_PX);
  const right = dx > commit || (dx > 0 && vx > FLICK_VELOCITY);
  const left = -dx > commit || (dx < 0 && vx < -FLICK_VELOCITY);
  if (start.drawer > 0.5) {
    const close = dx > drawerCommit || (dx > 0 && vx > FLICK_VELOCITY);
    return close ? { progress: 1, drawer: 0, action: 'membersClosed' } : { progress: 1, drawer: 1, action: 'membersOpen' };
  }
  if (start.progress > 0.5) {
    if (dx < 0 && start.canMembers) {
      const open = -dx > drawerCommit || vx < -FLICK_VELOCITY;
      return open ? { progress: 1, drawer: 1, action: 'membersOpen' } : { progress: 1, drawer: 0, action: 'membersClosed' };
    }
    return right ? { progress: 0, drawer: 0, action: 'nav' } : { progress: 1, drawer: 0, action: null };
  }
  return left ? { progress: 1, drawer: 0, action: 'content' } : { progress: 0, drawer: 0, action: null };
}

/**
 * Whether a touch at `x` (from the shell's left edge) belongs to the edge zone: the
 * conversation is in front, its member list is closed and exists, and the finger came down in
 * the rightmost strip.
 */
export function edgeZoneAccepts(x: number, width: number, start: DragStart): boolean {
  'worklet';
  return start.progress > 0.5 && start.drawer < 0.5 && start.canMembers && x >= width - EDGE_ZONE_PX;
}
