/**
 * Which RTP sender carries a given local MediaStreamTrack.
 *
 * The microphone pipeline (./micPipeline.ts) reads its input level from the sender's
 * `media-source` statistics, but it builds the track before LiveKit publishes it and is
 * never told where it went. The E2EE manager sees every sender as LiveKit creates it
 * (LocalSenderCreated, with the track), so it notes the pair here and the pipeline looks
 * its own track up.
 */
import type { RTCRtpSender } from '@livekit/react-native-webrtc';

const byTrack = new WeakMap<object, RTCRtpSender>();

export function noteTrackSender(track: object | undefined, sender: RTCRtpSender): void {
  if (track) byTrack.set(track, sender);
}

export function forgetTrackSender(track: object | undefined): void {
  if (track) byTrack.delete(track);
}

export function senderForTrack(track: object): RTCRtpSender | undefined {
  return byTrack.get(track);
}
