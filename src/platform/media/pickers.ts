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
 *   included - instead of sending it to everyone in the room. Videos are passed through as
 *   the system hands them over, and an iPhone recording carries where it was made in its
 *   keyed QuickTime metadata.
 * - **Android: the original.** The file is sent as picked: the system photo picker withholds
 *   location from apps without ACCESS_MEDIA_LOCATION (this app does not ask for it), but a
 *   camera app's photo or video comes back with its GPS tags, and so may a pick through an
 *   older picker.
 * - **Less where it was taken, on both.** Every image-picker pick has its location metadata
 *   removed in place (stripLocation.ts) before it is handed on - on iOS too, where a
 *   re-encoded photo has nothing left to find (checking it costs a read of its first
 *   segments) but a video does. A file that cannot be checked is refused, not sent unchecked.
 * - **Copies in the cache**, marked `owned`, so a pick that is removed unsent is deleted.
 * - **Optional crop** (`crop`), for avatars, banners and icons: the platform's own crop
 *   screen after the pick. It limits the pick to one image (neither platform crops a
 *   multi-selection), the result is a still JPEG/PNG (an animated GIF loses its animation),
 *   and `aspect` is honoured on Android only - iOS always crops a square.
 */
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ATTACHMENTS_PER_MESSAGE } from '@web-original/lib/attachments/format';
import { appStorage } from '../storage';
import { deleteFileQuietly, normalizePickedFile } from './files';
import { stripLocation } from './stripLocation';
import type { LocalFile } from './types';

export type PickResult =
  | { status: 'picked'; files: LocalFile[] }
  | { status: 'cancelled' }
  | { status: 'denied'; permission: 'camera' }
  | { status: 'failed'; message: string };

/** The crop screen shown after picking; `aspect` as [width, height], e.g. [1, 1] for an avatar. */
export interface CropOptions {
  aspect?: [number, number];
}

/**
 * Where a pick was started: the composer of a room. A pick that only arrives after Android
 * restarted the app (see `recoverPendingPick`) goes back there; one without an origin (an
 * avatar, a banner...) is thrown away, since the screen that wanted it is gone.
 */
export interface PickOrigin {
  kind: 'composer';
  roomId: string;
}

const PICK_ORIGIN_KEY = 'media.pickOrigin';

/**
 * Note where the picker about to open was started, for the pick that may outlive the process.
 * Every launch writes it - an absent origin removes the last one - so a recovered pick is never
 * matched with an earlier pick's room.
 */
function rememberOrigin(origin: PickOrigin | undefined): void {
  if (Platform.OS !== 'android') return;
  try {
    if (origin) appStorage.set(PICK_ORIGIN_KEY, JSON.stringify(origin));
    else appStorage.remove(PICK_ORIGIN_KEY);
  } catch {
    /* a recovered pick is then dropped rather than misplaced */
  }
}

function forgetOrigin(): void {
  if (Platform.OS !== 'android') return;
  try {
    appStorage.remove(PICK_ORIGIN_KEY);
  } catch {
    /* overwritten by the next launch anyway */
  }
}

function readOrigin(): PickOrigin | null {
  try {
    const raw = appStorage.getString(PICK_ORIGIN_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<PickOrigin> | null;
    return o?.kind === 'composer' && typeof o.roomId === 'string' && o.roomId ? { kind: 'composer', roomId: o.roomId } : null;
  } catch {
    return null;
  }
}

/** Open an image-picker screen with its origin noted until it returns. */
async function launch(origin: PickOrigin | undefined, open: () => Promise<ImagePicker.ImagePickerResult>): Promise<PickResult> {
  rememberOrigin(origin);
  try {
    return fromImagePicker(await open());
  } finally {
    forgetOrigin();
  }
}

function cropOptions(crop: CropOptions | undefined): ImagePicker.ImagePickerOptions {
  if (!crop) return {};
  const aspect = crop.aspect && crop.aspect[0] > 0 && crop.aspect[1] > 0 ? crop.aspect : undefined;
  return { allowsEditing: true, ...(aspect ? { aspect } : {}) };
}

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
  return withoutLocation({ status: 'picked', files: result.assets.map((a) => normalizePickedFile({ ...a, owned: true })) });
}

/** The picked copies lose their location metadata, or the pick fails (see the top). */
function withoutLocation(result: PickResult): PickResult {
  if (result.status !== 'picked') return result;
  try {
    for (const f of result.files) stripLocation(f.uri);
    return result;
  } catch (e) {
    for (const f of result.files) deleteFileQuietly(f.uri);
    return failed(e);
  }
}

function failed(e: unknown): PickResult {
  return { status: 'failed', message: e instanceof Error ? e.message : String(e) };
}

/**
 * Photos and videos from the library. `limit` caps the selection (pass the composer's free
 * slots); `mediaTypes` narrows it; `crop` shows the crop screen (one image only).
 */
export async function pickFromLibrary(
  opts: { limit?: number; mediaTypes?: ('images' | 'videos')[]; crop?: CropOptions; origin?: PickOrigin } = {},
): Promise<PickResult> {
  const limit = opts.crop ? 1 : Math.max(1, opts.limit ?? ATTACHMENTS_PER_MESSAGE);
  try {
    return await launch(opts.origin, () =>
      ImagePicker.launchImageLibraryAsync({
        ...mediaOptions(),
        ...cropOptions(opts.crop),
        mediaTypes: opts.crop ? ['images'] : (opts.mediaTypes ?? ['images', 'videos']),
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

/** A photo from the camera; `crop` shows the crop screen after the shot. */
export async function takePhoto(opts: { crop?: CropOptions; origin?: PickOrigin } = {}): Promise<PickResult> {
  try {
    if (!(await cameraAllowed())) return { status: 'denied', permission: 'camera' };
    return await launch(opts.origin, () =>
      ImagePicker.launchCameraAsync({ ...mediaOptions(), ...cropOptions(opts.crop), mediaTypes: ['images'] }),
    );
  } catch (e) {
    return failed(e);
  }
}

/** A video from the camera; `maxDurationSec` stops the recording there. */
export async function recordVideo(opts: { maxDurationSec?: number; origin?: PickOrigin } = {}): Promise<PickResult> {
  try {
    if (!(await cameraAllowed())) return { status: 'denied', permission: 'camera' };
    return await launch(opts.origin, () =>
      ImagePicker.launchCameraAsync({
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
 * the next start (once: the native side hands it out a single time). It comes back with the
 * room whose composer asked for it - not whichever conversation happens to open first, which
 * would put one person's photo in another's message. A pick with no composer origin (an
 * avatar, a banner) has nowhere to go and its files are deleted.
 */
export async function recoverPendingPick(): Promise<{ roomId: string; result: PickResult } | null> {
  if (Platform.OS !== 'android') return null;
  let result: PickResult;
  try {
    const pending = await ImagePicker.getPendingResultAsync();
    if (!pending) return null;
    result = 'code' in pending ? { status: 'failed', message: pending.message } : fromImagePicker(pending);
  } catch (e) {
    result = failed(e);
  }
  const origin = readOrigin();
  forgetOrigin();
  if (!origin) {
    if (result.status === 'picked') for (const f of result.files) deleteFileQuietly(f.uri);
    return null;
  }
  return { roomId: origin.roomId, result };
}
