/**
 * One page of the media viewer: an image that pinches to zoom (1-4x), double-taps between fit
 * and 2.5x around the tapped point, pans while zoomed, and - at fit - drags down (or up) to
 * dismiss the viewer. A single tap toggles the viewer's chrome.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { t } from '@web/i18n/t';
import { Skeleton, Text } from '@/ui';

export const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

export interface ZoomRequest {
  scale: number;
  nonce: number;
}

export interface ZoomableImageProps {
  uri: string;
  label: string;
  width: number;
  height: number;
  active: boolean;
  reduceMotion: boolean;
  /** Muted text on the black stage (the failure notice). */
  mutedColor: string;
  /** The viewer's shared drag-to-dismiss offset (backdrop fades with it). */
  dismissY: SharedValue<number>;
  zoomRequest: ZoomRequest | null;
  onZoomChange: (scale: number) => void;
  onDismiss: () => void;
  onFailed?: () => void;
  onToggleChrome: () => void;
}

function clamp(v: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, v));
}

export function ZoomableImage({
  uri,
  label,
  width,
  height,
  active,
  reduceMotion,
  mutedColor,
  dismissY,
  zoomRequest,
  onZoomChange,
  onDismiss,
  onFailed,
  onToggleChrome,
}: ZoomableImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const duration = reduceMotion ? 0 : 200;

  const report = (s: number) => {
    setZoomed(s > 1.01);
    onZoomChange(s);
  };

  // Leaving a page resets its zoom (the web keys zoom by image).
  useEffect(() => {
    if (active) return;
    scale.value = 1;
    saved.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
    setZoomed(false);
  }, [active, scale, saved, tx, ty, savedTx, savedTy]);

  // Zoom buttons in the viewer's bar.
  useEffect(() => {
    if (!zoomRequest || !active) return;
    const s = clamp(zoomRequest.scale, 1, MAX_ZOOM);
    scale.value = withTiming(s, { duration });
    saved.value = s;
    if (s <= 1) {
      tx.value = withTiming(0, { duration });
      ty.value = withTiming(0, { duration });
      savedTx.value = 0;
      savedTy.value = 0;
    }
    report(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomRequest?.nonce]);

  const gesture = useMemo(() => {
    const bound = (s: number, extent: number) => {
      'worklet';
      return Math.max(0, (extent * s - extent) / 2);
    };
    const pinch = Gesture.Pinch()
      .onUpdate((e) => {
        scale.value = clamp(saved.value * e.scale, 1, MAX_ZOOM);
      })
      .onEnd(() => {
        saved.value = scale.value;
        if (scale.value <= 1.01) {
          scale.value = withTiming(1, { duration });
          saved.value = 1;
          tx.value = withTiming(0, { duration });
          ty.value = withTiming(0, { duration });
          savedTx.value = 0;
          savedTy.value = 0;
        }
        runOnJS(report)(saved.value);
      });

    const pan = Gesture.Pan()
      .averageTouches(true)
      .onUpdate((e) => {
        if (saved.value > 1.01) {
          tx.value = clamp(savedTx.value + e.translationX, -bound(scale.value, width), bound(scale.value, width));
          ty.value = clamp(savedTy.value + e.translationY, -bound(scale.value, height), bound(scale.value, height));
        } else {
          dismissY.value = e.translationY;
        }
      })
      .onEnd((e) => {
        if (saved.value > 1.01) {
          savedTx.value = tx.value;
          savedTy.value = ty.value;
          return;
        }
        if (Math.abs(dismissY.value) > DISMISS_DISTANCE || Math.abs(e.velocityY) > DISMISS_VELOCITY) {
          runOnJS(onDismiss)();
        } else {
          dismissY.value = withTiming(0, { duration });
        }
      });
    // At fit, only a vertical drag is ours: a sideways one belongs to the pager.
    if (zoomed) pan.minDistance(2);
    else pan.activeOffsetY([-12, 12]).failOffsetX([-12, 12]);

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd((e) => {
        if (saved.value > 1.01) {
          scale.value = withTiming(1, { duration });
          tx.value = withTiming(0, { duration });
          ty.value = withTiming(0, { duration });
          saved.value = 1;
          savedTx.value = 0;
          savedTy.value = 0;
          runOnJS(report)(1);
          return;
        }
        const s = DOUBLE_TAP_ZOOM;
        // Zoom around the tapped point.
        const nx = clamp((width / 2 - e.x) * (s - 1), -bound(s, width), bound(s, width));
        const ny = clamp((height / 2 - e.y) * (s - 1), -bound(s, height), bound(s, height));
        scale.value = withTiming(s, { duration });
        tx.value = withTiming(nx, { duration });
        ty.value = withTiming(ny, { duration });
        saved.value = s;
        savedTx.value = nx;
        savedTy.value = ny;
        runOnJS(report)(s);
      });
    const singleTap = Gesture.Tap()
      .requireExternalGestureToFail(doubleTap)
      .onEnd((_e, ok) => {
        if (ok) runOnJS(onToggleChrome)();
      });

    return Gesture.Simultaneous(Gesture.Simultaneous(pinch, pan), Gesture.Exclusive(doubleTap, singleTap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomed, width, height, duration, onDismiss, onToggleChrome]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value + (saved.value > 1.01 ? 0 : dismissY.value) }, { scale: scale.value }],
  }));

  return (
    <View style={{ width, height }}>
      {failed ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Text variant="body" align="center" color={mutedColor} style={styles.failed}>
            {t('attachments.viewer.failed')}
          </Text>
        </View>
      ) : (
        <GestureDetector gesture={gesture}>
          <Animated.View style={[StyleSheet.absoluteFill, style]} accessible accessibilityRole="image" accessibilityLabel={label}>
            {!loaded ? <Skeleton width={width - 32} height={Math.min(height * 0.5, 320)} style={styles.skeleton} /> : null}
            <Image
              source={{ uri }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              recyclingKey={uri}
              transition={reduceMotion ? 0 : 200}
              onLoad={() => setLoaded(true)}
              onError={() => {
                setFailed(true);
                onFailed?.();
              }}
            />
          </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  failed: { maxWidth: 280 },
  skeleton: { position: 'absolute', alignSelf: 'center', top: '25%', opacity: 0.4 },
});
