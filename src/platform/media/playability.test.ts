import { describe, expect, it } from '@jest/globals';
import { playbackBlocker } from './playability';

describe('playbackBlocker', () => {
  it('blocks WebM, Matroska and Ogg containers on iOS only', () => {
    expect(playbackBlocker('audio/webm', 'voice-message.webm', null, 'ios')).toBe('ios-container');
    expect(playbackBlocker('audio/ogg', 'voice-message.ogg', null, 'ios')).toBe('ios-container');
    expect(playbackBlocker('video/webm', 'screen.webm', null, 'ios')).toBe('ios-container');
    expect(playbackBlocker('video/x-matroska', 'film.mkv', null, 'ios')).toBe('ios-container');
    expect(playbackBlocker('audio/webm', 'voice-message.webm', null, 'android')).toBeNull();
    expect(playbackBlocker('video/webm', 'screen.webm', null, 'android')).toBeNull();
  });

  it('lets iOS play what AVFoundation opens', () => {
    for (const [type, name] of [
      ['audio/mp4', 'voice-message.m4a'],
      ['audio/mpeg', 'song.mp3'],
      ['audio/flac', 'take.flac'],
      ['audio/wav', 'beep.wav'],
      ['video/mp4', 'clip.mp4'],
      ['video/quicktime', 'IMG_0001.MOV'],
    ]) {
      expect(playbackBlocker(type, name, null, 'ios')).toBeNull();
    }
  });

  it('believes the bytes over the name', () => {
    const ogg = { ext: 'ogg', type: 'audio/ogg' };
    const mp4 = { ext: 'm4a', type: 'audio/mp4' };
    // Firefox: asked for WebM, wrote Ogg - unplayable either way.
    expect(playbackBlocker('audio/webm', 'voice-message.webm', ogg, 'ios')).toBe('ios-container');
    // Named WebM, actually MP4: plays.
    expect(playbackBlocker('audio/webm', 'voice-message.webm', mp4, 'ios')).toBeNull();
    // Named M4A, actually Ogg: does not.
    expect(playbackBlocker('audio/mp4', 'voice-message.m4a', ogg, 'ios')).toBe('ios-container');
  });

  it('prefers a media extension over the declared type, and falls back to the type', () => {
    expect(playbackBlocker('video/webm', 'clip.mp4', null, 'ios')).toBeNull();
    expect(playbackBlocker('audio/ogg; codecs=opus', 'recording', null, 'ios')).toBe('ios-container');
    expect(playbackBlocker('application/ogg', 'stream', null, 'ios')).toBeNull(); // not audio/video by kind
  });

  it('only judges audio and video', () => {
    expect(playbackBlocker('image/webp', 'sticker.webp', null, 'ios')).toBeNull();
    expect(playbackBlocker('application/pdf', 'a.pdf', null, 'ios')).toBeNull();
  });
});
