import { beforeAll, describe, expect, it, jest } from '@jest/globals';

const mockModes: unknown[] = [];
jest.mock('expo-audio', () => ({
  setAudioModeAsync: async (mode: unknown) => {
    mockModes.push(mode);
  },
}));

type Playback = typeof import('./playback');
let playback: Playback;

beforeAll(() => {
  // stores/mediaPlayback reads the remembered volume at load; give it the app's storage shape.
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => undefined },
    configurable: true,
    writable: true,
  });
  playback = require('./playback') as Playback;
});

class FakePlayer {
  playing = false;
  pauses = 0;
  released = false;
  play() {
    if (this.released) throw new Error('released');
    this.playing = true;
  }
  pause() {
    if (this.released) throw new Error('released');
    this.playing = false;
    this.pauses++;
  }
}

describe('one player at a time', () => {
  it('starting a player pauses the one that was playing', async () => {
    const a = new FakePlayer();
    const b = new FakePlayer();
    await playback.playExclusive(a);
    expect(a.playing).toBe(true);
    await playback.playExclusive(b);
    expect(a.playing).toBe(false);
    expect(b.playing).toBe(true);
    // Re-claiming the active player does not pause it.
    playback.claimPlayer(b);
    expect(b.pauses).toBe(0);
  });

  it('a released player is forgotten, and a dead one is not touched', async () => {
    const a = new FakePlayer();
    const b = new FakePlayer();
    await playback.playExclusive(a);
    playback.releasePlayer(a);
    await playback.playExclusive(b);
    expect(a.pauses).toBe(0);

    // b is native-released (unmounted) without releasePlayer: claiming another must not throw.
    b.released = true;
    const c = new FakePlayer();
    await expect(playback.playExclusive(c)).resolves.toBeUndefined();
    expect(c.playing).toBe(true);
  });

  it('plays in the message-media mode, but leaves a call\'s session alone', async () => {
    const { setAudioSessionGuard } = require('./audioSession') as typeof import('./audioSession');
    mockModes.length = 0;
    await playback.playExclusive(new FakePlayer());
    expect(mockModes).toEqual([expect.objectContaining({ playsInSilentMode: true, allowsRecording: false })]);
    setAudioSessionGuard(() => true);
    await playback.playExclusive(new FakePlayer());
    expect(mockModes).toHaveLength(1);
    setAudioSessionGuard(null);
  });
});
