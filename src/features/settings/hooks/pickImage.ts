/**
 * Choose an image for an avatar, banner, space icon, bot picture or custom emoji: a sheet
 * offering the camera and the photo library (the platform pickers), then the web's checks -
 * an image type, and a size cap - before anything is uploaded.
 *
 * The web functions that upload (`uploadAvatar`, `uploadSpaceIcon`, `uploadSpaceEmoji`...)
 * append the file to a FormData; React Native's FormData takes `{ uri, name, type }` for a
 * file, so `asUploadFile` hands them exactly that.
 */
import { pickFromLibrary, takePhoto, type CropOptions, type LocalFile } from '@/platform/media';
import { showActionSheet } from '@/ui';
import { t } from '@web/i18n/t';

/** The web's profile image limit (ProfileSettingsPage, DevelopersSettingsPage). */
export const PROFILE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export type ImagePick =
  | { status: 'picked'; file: LocalFile }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface PickImageOptions {
  title?: string;
  maxBytes?: number;
  /** Allowed MIME types; default any image/*. */
  accept?: readonly string[];
  /** Offer the camera (default true). An emoji is rarely a photo; it still may be. */
  camera?: boolean;
  /**
   * Show the platform's crop screen after the pick (one image). Square for avatars and icons;
   * left off for banners (iOS only crops squares) and emoji (cropping flattens an animated GIF).
   */
  crop?: CropOptions;
}

/** The web's checks on a chosen file. Returns the error message, or null when it may be sent. */
export function validateImage(file: Pick<LocalFile, 'type' | 'size'>, opts: { maxBytes?: number; accept?: readonly string[] } = {}): string | null {
  const type = (file.type || '').toLowerCase();
  const typeOk = opts.accept ? opts.accept.includes(type) : type.startsWith('image/');
  if (!typeOk) return t('settings.profile.imageTypeError');
  if (opts.maxBytes != null && file.size > opts.maxBytes) return t('settings.profile.imageSizeError');
  return null;
}

/** Sheet (camera / library) -> picker -> checks. Never throws. */
export async function pickImage(opts: PickImageOptions = {}): Promise<ImagePick> {
  const source = await new Promise<'camera' | 'library' | null>((resolve) => {
    let chosen: 'camera' | 'library' | null = null;
    void showActionSheet(
      [
        opts.camera !== false && {
          key: 'camera',
          label: t('mobile.settings.takePhoto'),
          icon: 'camera',
          onSelect: () => {
            chosen = 'camera';
          },
        },
        {
          key: 'library',
          label: t('mobile.settings.chooseFromLibrary'),
          icon: 'images',
          onSelect: () => {
            chosen = 'library';
          },
        },
      ],
      opts.title ? { title: opts.title } : undefined,
    ).then(() => resolve(chosen));
  });
  if (!source) return { status: 'cancelled' };
  const crop = opts.crop ? { crop: opts.crop } : {};
  const res = source === 'camera' ? await takePhoto(crop) : await pickFromLibrary({ limit: 1, mediaTypes: ['images'], ...crop });
  if (res.status === 'cancelled') return { status: 'cancelled' };
  if (res.status === 'denied') return { status: 'error', message: t('mobile.media.cameraDenied') };
  if (res.status === 'failed') return { status: 'error', message: res.message || t('settings.profile.uploadFailed') };
  const file = res.files[0];
  if (!file) return { status: 'cancelled' };
  const problem = validateImage(file, opts);
  if (problem) return { status: 'error', message: problem };
  return { status: 'picked', file };
}

/**
 * The value the web's upload functions put in their FormData. Typed as the DOM File their
 * signatures name; on React Native FormData sends `{ uri, name, type }` as a file part.
 */
export function asUploadFile(file: LocalFile): File {
  return { uri: file.uri, name: file.name, type: file.type } as unknown as File;
}
