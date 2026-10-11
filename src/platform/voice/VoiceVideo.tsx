/**
 * A call's camera or screen track, by the sid the voice store keeps in `voice.media`.
 *
 * The web's tiles attach a LiveKit track to a <video>; here @livekit/react-native's
 * VideoTrack renders it natively. This only resolves the sid to the track reference it
 * wants and follows the store, so a tile re-renders when the track arrives or goes (and
 * renders nothing in between - show the avatar). Adaptive stream sees the view's size
 * through VideoTrack, as it sees the element's on the web.
 */
import { VideoTrack } from '@livekit/react-native';
import type { ViewStyle } from 'react-native';
import { useSolid } from '@/bridge/solid';
import { videoTrackRef } from '@/platform/overrides/voice/stores/voice';

export interface VoiceVideoProps {
  /** `voice.media[userId].camera` or `.screen`. */
  sid: string | undefined;
  /** Mirror your own front camera when `voiceSettings.mirrorCamera` is on. */
  mirror?: boolean;
  /** 'cover' for cameras, 'contain' for screens (as the web's tiles). */
  objectFit?: 'cover' | 'contain';
  style?: ViewStyle;
  /** Stacking among overlapping video views (the spotlight over the strip). */
  zOrder?: number;
}

export function VoiceVideo({ sid, mirror, objectFit = 'cover', style, zOrder }: VoiceVideoProps) {
  const ref = useSolid(() => videoTrackRef(sid), [sid]);
  if (!ref) return null;
  // The trackRef type lives in @livekit/components-react, which the app does not install;
  // the shape ({ participant, publication, source }) is what VoiceTrackRef carries.
  return <VideoTrack trackRef={ref as never} mirror={mirror} objectFit={objectFit} style={style} zOrder={zOrder} />;
}
