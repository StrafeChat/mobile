/**
 * The microphone: press and hold to record a voice message (Discord / WhatsApp mobile).
 * While held, sliding towards the start edge cancels and sliding up locks the recording
 * hands-free; letting go stops it and sends. A quick tap explains the gesture. Screen-reader
 * users activate it to start a locked recording, then send or discard from the bar.
 */
import { useRef } from 'react';
import { I18nManager, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Icon, haptics, toast, withAlpha } from '@/ui';
import { classifyDrag } from '../logic/recordGesture';
import type { VoiceRecorderControls } from '../hooks/useVoiceRecorder';

export interface MicButtonProps {
  recorder: VoiceRecorderControls;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  disabled?: boolean;
  supported: boolean;
}

type Hold = 'idle' | 'held' | 'locked' | 'cancelled';

/** How long the press must last before it records (shorter is a tap). */
const HOLD_MS = 180;

export function MicButton({ recorder, dragX, dragY, disabled, supported }: MicButtonProps) {
  const theme = useTheme();
  const hold = useRef<Hold>('idle');
  const rtl = I18nManager.isRTL;
  const recording = recorder.state.phase !== 'idle';

  const pan = Gesture.Pan()
    .enabled(!disabled && supported)
    .activateAfterLongPress(HOLD_MS)
    .runOnJS(true)
    .onStart(() => {
      hold.current = 'held';
      dragX.value = 0;
      dragY.value = 0;
      recorder.begin(false);
    })
    .onUpdate((e) => {
      if (hold.current !== 'held') return;
      dragX.value = e.translationX;
      dragY.value = e.translationY;
      const intent = classifyDrag(e.translationX, e.translationY, rtl);
      if (intent === 'cancel') {
        hold.current = 'cancelled';
        recorder.cancel();
      } else if (intent === 'lock') {
        hold.current = 'locked';
        recorder.lock();
      }
    })
    .onFinalize(() => {
      const was = hold.current;
      hold.current = 'idle';
      dragX.value = 0;
      dragY.value = 0;
      if (was === 'held') recorder.finish();
    });

  const tap = Gesture.Tap()
    .enabled(!disabled)
    .runOnJS(true)
    .onEnd((_e, success) => {
      if (!success) return;
      haptics.selection();
      toast(supported ? t('mobile.composer.holdToRecord') : t('composer.voiceUnavailable'));
    });

  const label = supported ? t('composer.recordVoice') : t('composer.voiceUnavailable');

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={supported ? t('mobile.composer.holdToRecordHint') : undefined}
        accessibilityState={{ disabled: !!disabled || !supported }}
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'activate' && !disabled && supported && !recording) recorder.begin(true);
        }}
        testID="composer-mic"
        hitSlop={4}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: recording ? theme.colors.destructive : withAlpha(theme.colors.muted, 0.7),
          opacity: disabled || !supported ? 0.5 : 1,
          transform: [{ scale: recording && !recorder.state.locked ? 1.25 : 1 }],
        }}
      >
        <Icon name="microphone" size={18} color={recording ? theme.colors.destructiveForeground : theme.colors.mutedForeground} />
      </View>
    </GestureDetector>
  );
}
