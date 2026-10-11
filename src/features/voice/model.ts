/**
 * The voice UI's pure logic: tile layout, the tile list, who we still wait on for keys, who
 * can be rung again, and how join errors read. No React, no stores - the hooks and screens
 * feed these from the shared voice store (web/src/stores/voice.ts) so the rules match the
 * web's VoiceStage / VoiceTile / VoiceDock exactly and can be tested on their own.
 */
import { ApiError } from '@web/api/ApiError';

/** Space between tiles (the web's `gap-2`). */
export const TILE_GAP = 8;
/** A compact tile in the strip under a spotlight. */
export const STRIP_TILE = { w: 128, h: 96 } as const;
/** Height the strip takes from the spotlight, gap included. */
export const STRIP_HEIGHT = STRIP_TILE.h + TILE_GAP;
/** The web's tiles are 16:9. */
export const WIDE_ASPECT = 16 / 9;
/**
 * The tallest tile we draw on a portrait phone (3:4). A strict 16:9 grid on a phone held
 * upright leaves most of the screen empty; letting a tile grow down to 3:4 fills it the way
 * a phone call app does, while landscape and tablets still land on 16:9.
 */
export const PORTRAIT_MIN_ASPECT = 3 / 4;

export interface FitOptions {
  gap?: number;
  /** Narrowest tile shape (width / height). */
  minAspect?: number;
  /** Widest tile shape (width / height). */
  maxAspect?: number;
}

export interface TileFit {
  cols: number;
  w: number;
  h: number;
}

/**
 * The largest tiles at which `count` of them fit a `width` x `height` box, and the column
 * count that gets there. The web's fitTiles (VoiceStage.tsx) with the aspect ratio allowed
 * to vary between `minAspect` and `maxAspect`: with both at 16:9 (the defaults) it chooses
 * exactly what the web chooses. Measured rather than left to flexbox for the web's reason -
 * tiles sized from their width alone ran over the controls on a short stage.
 */
export function fitTiles(width: number, height: number, count: number, opts: FitOptions = {}): TileFit {
  const gap = opts.gap ?? TILE_GAP;
  const maxAspect = opts.maxAspect ?? WIDE_ASPECT;
  const minAspect = Math.min(opts.minAspect ?? maxAspect, maxAspect);
  if (count <= 0 || width <= 0 || height <= 0) return { cols: 1, w: 0, h: 0 };
  let best: TileFit = { cols: 1, w: 0, h: 0 };
  let bestArea = 0;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (width - gap * (cols - 1)) / cols;
    const cellH = (height - gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    let w = cellW;
    let h = cellH;
    const aspect = cellW / cellH;
    if (aspect > maxAspect) w = cellH * maxAspect;
    else if (aspect < minAspect) h = cellW / minAspect;
    w = Math.floor(w);
    h = Math.floor(h);
    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      best = { cols, w, h };
    }
  }
  return best;
}

/** What a tile needs from a server voice state (api/voice VoiceState). */
export interface VoiceStateLike {
  user_id: string;
  session_id?: string;
  identity?: string;
  self_mute: boolean;
  self_deaf: boolean;
  mute: boolean;
  deaf: boolean;
  self_video: boolean;
  self_stream: boolean;
  priority_speaker: boolean;
  connected: boolean;
  joined_at: string;
  user?: { display_name?: string; username?: string; avatar?: string };
}

export interface CallTile {
  /** "<userId>" or "<userId>:screen" - the voice store's focus key. */
  key: string;
  userId: string;
  kind: 'user' | 'screen';
  name: string;
  avatar?: string;
  isLocal: boolean;
  selfMute: boolean;
  /** Muted by a moderator (drawn red). */
  serverMute: boolean;
  selfDeaf: boolean;
  serverDeaf: boolean;
  streaming: boolean;
  video: boolean;
  priority: boolean;
  /** LiveKit confirmed the connection (a spinner until then). */
  connected: boolean;
}

/** States in join order (the web sorts by joined_at everywhere). */
export function sortByJoined<T extends { joined_at: string }>(states: readonly T[]): T[] {
  return [...states].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
}

/**
 * One tile per person (camera or avatar), plus one per shared screen while they stream or a
 * screen track exists - VoiceStage's `tiles`.
 */
export function buildCallTiles(
  states: readonly VoiceStateLike[],
  opts: {
    meId: string | null | undefined;
    hasScreenTrack: (userId: string) => boolean;
    nameOf: (st: VoiceStateLike) => string;
    avatarOf: (st: VoiceStateLike) => string | undefined;
  },
): CallTile[] {
  const out: CallTile[] = [];
  for (const st of sortByJoined(states)) {
    const avatar = opts.avatarOf(st);
    const base = {
      userId: st.user_id,
      name: opts.nameOf(st),
      ...(avatar ? { avatar } : {}),
      isLocal: !!opts.meId && st.user_id === opts.meId,
      selfMute: st.self_mute,
      serverMute: st.mute,
      selfDeaf: st.self_deaf,
      serverDeaf: st.deaf,
      streaming: st.self_stream,
      video: st.self_video,
      priority: st.priority_speaker,
      connected: st.connected,
    };
    out.push({ key: st.user_id, kind: 'user', ...base });
    if (st.self_stream || opts.hasScreenTrack(st.user_id)) out.push({ key: `${st.user_id}:screen`, kind: 'screen', ...base });
  }
  return out;
}

/** Split tiles into the spotlight and the strip under it (no spotlight: everything in the grid). */
export function splitFocus(tiles: readonly CallTile[], focus: string | null | undefined): { focused: CallTile | undefined; strip: CallTile[] } {
  const focused = focus ? tiles.find((t) => t.key === focus) : undefined;
  return { focused, strip: focused ? tiles.filter((t) => t.key !== focused.key) : [] };
}

/** The LiveKit identity the server issued for a state (federated form in shared rooms). */
export function identityOf(st: Pick<VoiceStateLike, 'identity' | 'user_id' | 'session_id'>): string {
  return st.identity ?? `${st.user_id}.${st.session_id ?? ''}`;
}

/**
 * Connected participants whose media key has not arrived - "Waiting for encryption keys
 * from …" (VoiceStage's `unkeyed`). Matched on the issued identity, not the user id.
 */
export function unkeyedNames(
  states: readonly VoiceStateLike[],
  keyed: readonly string[],
  nameOf: (st: VoiceStateLike) => string,
): string[] {
  const have = new Set(keyed);
  return sortByJoined(states)
    .filter((st) => st.connected && !have.has(identityOf(st)))
    .map(nameOf);
}

/** Room participants who are not in the call (and are not you): who "Ring again" rings. */
export function absentParticipantIds(
  participants: readonly { id: string }[] | undefined,
  states: readonly { user_id: string }[],
  meId: string | null | undefined,
): string[] {
  if (!participants) return [];
  const inCall = new Set(states.map((s) => s.user_id));
  return participants.filter((p) => !inCall.has(p.id) && p.id !== meId).map((p) => p.id);
}

/** "Ringing A, B…" names from the call's ringing list; unknown people read as '…'. */
export function ringingNames(
  call: { ringing: readonly string[] } | undefined,
  participants: readonly { id: string; display_name?: string; username?: string }[] | undefined,
): string {
  if (!call || call.ringing.length === 0) return '';
  return call.ringing
    .map((uid) => {
      const p = participants?.find((x) => x.id === uid);
      return p ? p.display_name || p.username || '…' : '…';
    })
    .join(', ');
}

/** The dock / header status icon for a connection quality (VoiceDock's qualityIcon). */
export function qualityIcon(quality: string): string {
  switch (quality) {
    case 'poor':
      return 'triangle-exclamation';
    case 'lost':
      return 'xmark';
    default:
      return 'signal';
  }
}

/** i18n key of the session's status line (VoiceDock's statusText). */
export function statusKey(status: string): string {
  switch (status) {
    case 'connecting':
      return 'voice.connecting';
    case 'reconnecting':
      return 'voice.reconnecting';
    default:
      return 'voice.connected';
  }
}

/**
 * Store error keys whose web wording is about a browser ("allow it in your browser") have
 * a phone version; every other key reads as the web's.
 */
const MOBILE_ERROR_KEYS: Record<string, string> = {
  'voice.errors.micDenied': 'mobile.voice.errors.micDenied',
  'voice.errors.cameraDenied': 'mobile.voice.errors.cameraDenied',
  'voice.errors.e2eeUnsupported': 'mobile.voice.errors.e2eeUnsupported',
};

export function voiceErrorKey(key: string): string {
  return MOBILE_ERROR_KEYS[key] ?? key;
}

/** A join failure as the web's VoiceStage reports it: an i18n key, or the server's own message. */
export type JoinErrorText = { key: string } | { message: string };

/**
 * joinVoiceRoom's errors, mapped the way the web maps them (VoiceStage.join): encryption
 * unsupported, 403 no Connect permission, 409 full, another API error's message, else the
 * generic failure.
 */
export function joinErrorText(err: unknown, isEncryptionUnsupported: (e: unknown) => boolean): JoinErrorText {
  if (isEncryptionUnsupported(err)) return { key: voiceErrorKey('voice.errors.e2eeUnsupported') };
  if (err instanceof ApiError) {
    if (err.status === 403) return { key: 'voice.noConnect' };
    if (err.status === 409) return { key: 'voice.full' };
    if (err.message) return { message: err.message };
  }
  return { key: 'voice.errors.joinFailed' };
}

/** "12.5%" under ten, "37%" above - the stats popover's fmtPct. */
export function fmtPct(v: number): string {
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
}

/** How many avatars the dock shows before a "+N". */
export const DOCK_MAX_AVATARS = 3;

export function avatarOverflow<T>(list: readonly T[], max: number): { shown: T[]; overflow: number } {
  return { shown: list.slice(0, max), overflow: Math.max(0, list.length - max) };
}
