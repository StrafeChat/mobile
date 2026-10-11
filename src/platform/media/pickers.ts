/**
 * The three ways a file gets into the composer - photo library, camera, files - each
 * returning LocalFiles ready for `draft.addFiles(result.files)`.
 *
 * Choices made for every pick:
 *
 * - **No library permission.** The photo library opens the system picker (PHPicker on iOS,
 *   the Android photo picker), which needs no access to the user's library: the app only ever
 *   sees what was chosen. Only the camera asks for permission.
 * - **iOS: compatible representation, re-encoded.** HEIC photos and HEVC videos become JPEG
 *   and H.264, which every recipient can open (Chrome and Firefox show no HEIC). Images are
 *   re-encoded at 0.92 quality on the way, which also drops their metadata - GPS position
 *   included - instead of sending it to everyone in the room.
 * - **Android: the original.** The system photo picker withholds location metadata from apps
 *   without ACCESS_MEDIA_LOCATION (this app does not ask for it), so the file is sent as picked.
 * - **Copies in the cache**, marked `owned`, so a pick that is removed unsent is deleted.
 */
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ATTACHMENTS_PER_MESSAGE } from '@web-original/lib/attachments/format';
import { normalizePickedFile } from './files';
import type { LocalFile } from './types';

export type PickResult =
  | { status: 'picked'; files: LocalFile[] }
  | { status: 'cancelled' }
  | { status: 'denied'; permission: 'camera' }
  | { status: 'failed'; message: string };

function mediaOptions(): ImagePicker.ImagePickerOptions {
  return Platform.OS === 'ios'
    ? {
        quality: 0.92,
        exif: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      }
    : { quality: 1, exif: false };
}

function fromImagePicker(result: ImagePicker.ImagePickerResult): PickResult {
  if (result.canceled || !result.assets?.length) return { status: 'cancelled' };
  return { status: 'picked', files: result.assets.map((a) => normalizePickedFile({ ...a, owned: true })) };
}

function failed(e: unknown): PickResult {
  return { status: 'failed', message: e instanceof Error ? e.message : String(e) };
}

/**
 * Photos and videos from the library. `limit` caps the selection (pass the composer's free
 * slots); `mediaTypes` narrows it.
 */
export async function pickFromLibrary(
  opts: { limit?: number; mediaTypes?: ('images' | 'videos')[] } = {},
): Promise<PickResult> {
  const limit = Math.max(1, opts.limit ?? ATTACHMENTS_PER_MESSAGE);
  try {
    return fromImagePicker(
      await ImagePicker.launchImageLibraryAsync({
        ...mediaOptions(),
        mediaTypes: opts.mediaTypes ?? ['images', 'videos'],
        allowsMultipleSelection: limit > 1,
        selectionLimit: limit,
        orderedSelection: true,
      }),
    );
  } catch (e) {
    return failed(e);
  }
}

async function cameraAllowed(): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await ImagePicker.requestCameraPermissionsAsync()).granted;
}

/** A photo from the camera. */
export async function takePhoto(): Promise<PickResult> {
  try {
    if (!(await cameraAllowed())) return { status: 'denied', permission: 'camera' };
    return fromImagePicker(await ImagePicker.launchCameraAsync({ ...mediaOptions(), mediaTypes: ['images'] }));
  } catch (e) {
    return failed(e);
  }
}

/** A video from the camera; `maxDurationSec` stops the recording there. */
export async function recordVideo(opts: { maxDurationSec?: number } = {}): Promise<PickResult> {
  try {
    if (!(await cameraAllowed())) return { status: 'denied', permission: 'camera' };
    return fromImagePicker(
      await ImagePicker.launchCameraAsync({
        ...mediaOptions(),
        mediaTypes: ['videos'],
        ...(opts.maxDurationSec ? { videoMaxDuration: opts.maxDurationSec } : {}),
      }),
    );
  } catch (e) {
    return failed(e);
  }
}

/** Any files, from the system document picker (copied into the app's cache). */
export async function pickDocuments(opts: { multiple?: boolean; types?: string | string[] } = {}): Promise<PickResult> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: opts.types ?? '*/*',
      multiple: opts.multiple ?? true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return { status: 'cancelled' };
    return { status: 'picked', files: result.assets.map((a) => normalizePickedFile({ ...a, owned: true })) };
  } catch (e) {
    return failed(e);
  }
}

/**
 * Android can stop the app while the camera or picker is in front; the pick then arrives on
 * the next start. Call once when the composer mounts and queue whatever comes back.
 */
export async function recoverPendingPick(): Promise<PickResult | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const pending = await ImagePicker.getPendingResultAsync();
    if (!pending) return null;
    if ('code' in pending) return { status: 'failed', message: pending.message };
    return fromImagePicker(pending);
  } catch (e) {
    return failed(e);
  }
}
