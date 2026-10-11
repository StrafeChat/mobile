/**
 * The voice UI's pure rules: tile layout (the web's fitTiles, plus the portrait variant),
 * the tile list, the key-wait and ring-again lists, and how join errors read.
 */
import { describe, expect, test } from '@jest/globals';
import { ApiError } from '@web/api/ApiError';
import {
  PORTRAIT_MIN_ASPECT,
  absentParticipantIds,
  avatarOverflow,
  buildCallTiles,
  fitTiles,
  fmtPct,
  identityOf,
  joinErrorText,
  qualityIcon,
  ringingNames,
  splitFocus,
  statusKey,
  unkeyedNames,
  voiceErrorKey,
  type VoiceStateLike,
} from '../model';

/** The web's own fitTiles (web/src/components/voice/VoiceStage.tsx), verbatim, as the oracle. */
function webFitTiles(width: number, height: number, count: number, gap = 8) {
  const ASPECT = 16 / 9;
  if (count <= 0 || width <= 0 || height <= 0) return { cols: 1, w: 0, h: 0 };
  let best = { cols: 1, w: 0, h: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (width - gap * (cols - 1)) / cols;
    const cellH = (height - gap * (rows - 1)) / rows;
    const w = Math.floor(Math.min(cellW, cellH * ASPECT));
    if (w > best.w) best = { cols, w, h: Math.floor(w / ASPECT) };
  }
  return best;
}

function state(uid: string, over: Partial<VoiceStateLike> = {}): VoiceStateLike {
  return {
    user_id: uid,
    session_id: `s-${uid}`,
    self_mute: false,
    self_deaf: false,
    mute: false,
    deaf: false,
    self_video: false,
    self_stream: false,
    priority_speaker: false,
    connected: true,
    joined_at: '2026-10-01T00:00:00Z',
    user: { username: uid },
    ...over,
  };
}

describe('fitTiles', () => {
  test('with the default 16:9 it chooses exactly what the web chooses', () => {
    const boxes: [number, number][] = [
      [1280, 720],
      [800, 600],
      [390, 600],
      [1024, 400],
      [320, 240],
      [600, 1000],
    ];
    for (const [w, h] of boxes) {
      for (let n = 1; n <= 9; n++) {
        const ours = fitTiles(w, h, n);
        const web = webFitTiles(w, h, n);
        expect({ box: [w, h, n], cols: ours.cols, w: ours.w }).toEqual({ box: [w, h, n], cols: web.cols, w: web.w });
        // Height is the same up to the rounding of w / aspect.
        expect(Math.abs(ours.h - web.h)).toBeLessThanOrEqual(1);
      }
    }
  });

  test('nothing to lay out, or no room, gives an empty tile', () => {
    expect(fitTiles(0, 500, 3)).toEqual({ cols: 1, w: 0, h: 0 });
    expect(fitTiles(400, 500, 0)).toEqual({ cols: 1, w: 0, h: 0 });
  });

  test('portrait phones: one person fills the width at up to 3:4, two stack, four go 2 x 2', () => {
    const opts = { minAspect: PORTRAIT_MIN_ASPECT };
    const one = fitTiles(390, 600, 1, opts);
    expect(one).toEqual({ cols: 1, w: 390, h: 520 });
    const two = fitTiles(390, 600, 2, opts);
    expect(two.cols).toBe(1);
    expect(two.w).toBe(390);
    expect(two.h).toBe(296);
    const four = fitTiles(390, 600, 4, opts);
    expect(four.cols).toBe(2);
    // The grid always fits the box.
    for (let n = 1; n <= 12; n++) {
      const f = fitTiles(390, 600, n, opts);
      const rows = Math.ceil(n / f.cols);
      expect(f.cols * f.w + (f.cols - 1) * 8).toBeLessThanOrEqual(390);
      expect(rows * f.h + (rows - 1) * 8).toBeLessThanOrEqual(600);
      expect(f.w / f.h).toBeGreaterThanOrEqual(PORTRAIT_MIN_ASPECT - 0.01);
      expect(f.w / f.h).toBeLessThanOrEqual(16 / 9 + 0.01);
    }
  });

  test('landscape: two people sit side by side', () => {
    expect(fitTiles(800, 350, 2, { minAspect: PORTRAIT_MIN_ASPECT }).cols).toBe(2);
  });
});

describe('tiles', () => {
  const opts = {
    meId: 'me',
    hasScreenTrack: (uid: string) => uid === 'c',
    nameOf: (st: VoiceStateLike) => st.user?.username ?? '?',
    avatarOf: (st: VoiceStateLike) => (st.user_id === 'b' ? 'https://cdn/b.png' : undefined),
  };

  test('one per person in join order, plus a screen tile while streaming or with a screen track', () => {
    const tiles = buildCallTiles(
      [
        state('b', { joined_at: '2026-10-01T00:00:03Z', self_stream: true }),
        state('me', { joined_at: '2026-10-01T00:00:01Z', self_mute: true }),
        state('c', { joined_at: '2026-10-01T00:00:02Z', mute: true, deaf: true }),
      ],
      opts,
    );
    expect(tiles.map((t) => t.key)).toEqual(['me', 'c', 'c:screen', 'b', 'b:screen']);
    const me = tiles[0]!;
    expect(me.isLocal).toBe(true);
    expect(me.selfMute).toBe(true);
    const c = tiles[1]!;
    expect(c.serverMute).toBe(true);
    expect(c.serverDeaf).toBe(true);
    expect(tiles[3]!.avatar).toBe('https://cdn/b.png');
    expect(tiles[2]!.kind).toBe('screen');
  });

  test('spotlight splits the focused tile from the strip; an unknown focus is the grid', () => {
    const tiles = buildCallTiles([state('a'), state('b', { joined_at: '2026-10-02T00:00:00Z' })], opts);
    const { focused, strip } = splitFocus(tiles, 'b');
    expect(focused?.key).toBe('b');
    expect(strip.map((t) => t.key)).toEqual(['a']);
    expect(splitFocus(tiles, 'gone:screen')).toEqual({ focused: undefined, strip: [] });
    expect(splitFocus(tiles, null).focused).toBeUndefined();
  });
});

describe('encryption keys and ringing', () => {
  test('waiting for keys lists connected people whose issued identity is not keyed', () => {
    const states = [
      state('a'),
      state('b', { identity: '@b:other.example.s-b' }),
      state('c', { connected: false }),
      state('d', { joined_at: '2026-10-02T00:00:00Z' }),
    ];
    const keyed = ['a.s-a', 'b.s-b'];
    // b is keyed under the plain form but was issued the federated one: still waiting.
    expect(unkeyedNames(states, keyed, (s) => s.user_id.toUpperCase())).toEqual(['B', 'D']);
    expect(identityOf(states[1]!)).toBe('@b:other.example.s-b');
  });

  test('ring again targets participants who are not in the call, never yourself', () => {
    const participants = [{ id: 'me' }, { id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(absentParticipantIds(participants, [{ user_id: 'a' }], 'me')).toEqual(['b', 'c']);
    expect(absentParticipantIds(undefined, [], 'me')).toEqual([]);
  });

  test('ringing names come from participants, unknown people read as an ellipsis', () => {
    const participants = [
      { id: 'a', display_name: 'Ada', username: 'ada' },
      { id: 'b', display_name: '', username: 'bob' },
    ];
    expect(ringingNames({ ringing: ['a', 'b', 'x'] }, participants)).toBe('Ada, bob, …');
    expect(ringingNames({ ringing: [] }, participants)).toBe('');
    expect(ringingNames(undefined, participants)).toBe('');
  });
});

describe('status and errors', () => {
  test('quality icons and status lines follow the web dock', () => {
    expect(qualityIcon('poor')).toBe('triangle-exclamation');
    expect(qualityIcon('lost')).toBe('xmark');
    expect(qualityIcon('excellent')).toBe('signal');
    expect(statusKey('connecting')).toBe('voice.connecting');
    expect(statusKey('reconnecting')).toBe('voice.reconnecting');
    expect(statusKey('connected')).toBe('voice.connected');
  });

  test('join errors map as the web stage maps them', () => {
    class Unsupported extends Error {}
    const isUnsupported = (e: unknown) => e instanceof Unsupported;
    expect(joinErrorText(new Unsupported(), isUnsupported)).toEqual({ key: 'mobile.voice.errors.e2eeUnsupported' });
    expect(joinErrorText(new ApiError('no', 403), isUnsupported)).toEqual({ key: 'voice.noConnect' });
    expect(joinErrorText(new ApiError('full', 409), isUnsupported)).toEqual({ key: 'voice.full' });
    expect(joinErrorText(new ApiError('Voice is down', 503), isUnsupported)).toEqual({ message: 'Voice is down' });
    expect(joinErrorText(new TypeError('network'), isUnsupported)).toEqual({ key: 'voice.errors.joinFailed' });
  });

  test('browser-worded store errors get the phone wording; the rest stay the web keys', () => {
    expect(voiceErrorKey('voice.errors.micDenied')).toBe('mobile.voice.errors.micDenied');
    expect(voiceErrorKey('voice.errors.cameraDenied')).toBe('mobile.voice.errors.cameraDenied');
    expect(voiceErrorKey('voice.errors.keyShareFailed')).toBe('voice.errors.keyShareFailed');
  });

  test('small helpers', () => {
    expect(fmtPct(3.14159)).toBe('3.1%');
    expect(fmtPct(37.6)).toBe('38%');
    expect(avatarOverflow([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], overflow: 2 });
    expect(avatarOverflow([1], 3)).toEqual({ shown: [1], overflow: 0 });
  });
});
