/**
 * The call's audio output on a phone: loudspeaker, earpiece, a wired headset or Bluetooth.
 * The web's output-device picker becomes this (src/platform/voice/audioSession.ts does the
 * routing): tap the speaker button to flip speaker / earpiece, or pick from the routes that
 * are connected when a headset or Bluetooth device is around. iOS hands the choice to its
 * own route picker (AirPods, car, AirPlay), which knows those devices better than we can.
 */
import { Platform } from 'react-native';
import { t } from '@web/i18n/t';
import { listAudioOutputs, selectAudioRoute, showAudioRoutePicker, speakerphone, toggleSpeakerphone } from '@/platform/voice';
import { createExternalStore, showActionSheet, type ActionSheetEntry } from '@/ui';

export type RouteId = 'speaker' | 'earpiece' | 'headset' | 'bluetooth';

const ROUTE_ORDER: RouteId[] = ['speaker', 'earpiece', 'headset', 'bluetooth'];

/** The last route picked in this call (headset / Bluetooth are not visible in speakerphone()). */
export const pickedRouteStore = createExternalStore<RouteId | ''>('');

export function routeLabel(route: RouteId | ''): string {
  switch (route) {
    case 'speaker':
      return t('settings.voice.speaker');
    case 'earpiece':
      return t('mobile.voice.route.earpiece');
    case 'headset':
      return t('mobile.voice.route.headset');
    case 'bluetooth':
      return t('mobile.voice.route.bluetooth');
    default:
      return t('mobile.voice.route.auto');
  }
}

export function routeIcon(route: RouteId | ''): string {
  switch (route) {
    case 'earpiece':
      return 'phone';
    case 'headset':
      return 'headphones';
    case 'bluetooth':
      return 'fa-brands fa-bluetooth-b';
    default:
      return 'volume-high';
  }
}

/** What the speaker button shows: the picked device while it is in use, else speaker / earpiece. */
export function currentRoute(speakerOn: boolean, picked: RouteId | ''): RouteId {
  if (speakerOn) return 'speaker';
  if (picked === 'headset' || picked === 'bluetooth') return picked;
  return 'earpiece';
}

/** The routes worth offering, in a stable order, from the device's connected outputs. */
export function routeChoices(outputs: readonly string[]): RouteId[] {
  return ROUTE_ORDER.filter((r) => outputs.includes(r));
}

async function pick(route: RouteId | ''): Promise<void> {
  pickedRouteStore.set(route);
  await selectAudioRoute(route);
}

/** The full output list (or the iOS system picker). */
export async function chooseAudioRoute(): Promise<void> {
  if (Platform.OS === 'ios') {
    await showAudioRoutePicker();
    return;
  }
  const outputs = await listAudioOutputs();
  const choices = routeChoices(outputs.length ? outputs : ['speaker', 'earpiece']);
  const current = currentRoute(speakerphone(), pickedRouteStore.get());
  const entries: ActionSheetEntry[] = [
    ...choices.map((route) => ({
      key: route,
      label: routeLabel(route),
      icon: routeIcon(route),
      selected: route === current,
      onSelect: () => pick(route),
    })),
    'separator',
    {
      key: 'auto',
      label: routeLabel(''),
      description: t('mobile.voice.route.autoHint'),
      icon: 'wand-magic-sparkles',
      onSelect: () => pick(''),
    },
  ];
  await showActionSheet(entries, { title: t('mobile.voice.audioOutput') });
}

/**
 * The speaker button: with only the built-in speaker and earpiece it flips between them
 * (the common case, one tap); with a headset or Bluetooth connected it opens the list.
 */
export async function pressSpeakerButton(): Promise<void> {
  if (Platform.OS === 'android') {
    const outputs = await listAudioOutputs();
    if (outputs.includes('headset') || outputs.includes('bluetooth')) {
      await chooseAudioRoute();
      return;
    }
  }
  pickedRouteStore.set(speakerphone() ? 'earpiece' : 'speaker');
  await toggleSpeakerphone();
}
