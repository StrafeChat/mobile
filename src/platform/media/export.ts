/**
 * Getting an attachment out of the app: into the photo library, or to the share sheet (which
 * is also "Save to Files" on iOS and "open in another app" everywhere - the way out for a clip
 * this device cannot play, see ./playability.ts).
 *
 * Either way the file handed over is a named copy - the attachment's own filename, made safe
 * for the device - in `<cache>/strafe-media/export/`, not the cache's `<id>-<iv>` file, so the
 * library and the receiving app see "holiday.jpg". For an encrypted attachment that copy is
 * the decrypted file: leaving the app's encrypted context is exactly what the user asked for.
 * Copies are swept a while later (a receiving app may still be reading one when the share
 * sheet closes) and at start-up.
 */
import { Directory, File } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { attachmentKind, isVoiceMessage } from '@web-original/lib/attachments/format';
import type { AttachmentView } from '@web-original/lib/attachments/types';
import { AttachmentFetchError, getDecryptedAttachment, type AttachmentFetchErrorReason } from './attachmentCache';
import { absoluteUrl, mediaDirectory, randomName, sanitizeFilename } from './files';

export type ExportResult =
  /** Added to the photo library. */
  | { status: 'saved' }
  /** The share sheet was shown and has closed. */
  | { status: 'shared' }
  /** Photo-library permission was refused. */
  | { status: 'denied' }
  /** This device has no share sheet. */
  | { status: 'unavailable' }
  | { status: 'failed'; reason: AttachmentFetchErrorReason };

type ExportAttachment = Pick<AttachmentView, 'id' | 'url' | 'filename' | 'contentType' | 'size' | 'encryption' | 'previewUrl'>;

/** How long a handed-over copy is kept for the app that received it. */
const EXPORT_TTL_MS = 15 * 60 * 1000;

/** Delete export folders older than the TTL (all of them with `everything`). */
export function sweepExports(everything = false): void {
  try {
    const now = Date.now();
    for (const item of mediaDirectory('export').list()) {
      const stamp = Number(item.name.split('-')[0]);
      if (everything || !Number.isFinite(stamp) || now - stamp > EXPORT_TTL_MS) {
        try {
          item.delete();
        } catch {
          /* in use; next sweep */
        }
      }
    }
  } catch {
    /* nothing to sweep */
  }
}

/** A named, local copy of the attachment's (decrypted) bytes. */
async function exportCopy(att: ExportAttachment): Promise<File> {
  sweepExports();
  const folder = new Directory(mediaDirectory('export'), `${Date.now()}-${randomName(6)}`);
  folder.create({ intermediates: true, idempotent: true });
  const dest = new File(folder, sanitizeFilename(att.filename, att.contentType));
  if (att.previewUrl) {
    await new File(att.previewUrl).copy(dest, { overwrite: true });
  } else if (att.encryption) {
    const decrypted = await getDecryptedAttachment(att);
    await new File(decrypted.uri).copy(dest, { overwrite: true });
  } else {
    try {
      await File.downloadFileAsync(absoluteUrl(att.url), dest, { idempotent: true });
    } catch (e) {
      throw new AttachmentFetchError('network', e instanceof Error ? e.message : String(e));
    }
  }
  return dest;
}

function failure(e: unknown): ExportResult {
  return { status: 'failed', reason: e instanceof AttachmentFetchError ? e.reason : 'storage' };
}

/** Open the share sheet for the attachment. */
export async function shareAttachment(att: ExportAttachment): Promise<ExportResult> {
  try {
    if (!(await Sharing.isAvailableAsync())) return { status: 'unavailable' };
    const copy = await exportCopy(att);
    await Sharing.shareAsync(copy.uri, {
      ...(att.contentType ? { mimeType: att.contentType } : {}),
      dialogTitle: att.filename,
    });
    return { status: 'shared' };
  } catch (e) {
    return failure(e);
  }
}

/**
 * Save the attachment to the device: images and videos into the photo library (write-only
 * permission, asked for here), anything else - or media the library refuses, such as WebM on
 * iOS - through the share sheet.
 */
export async function saveAttachmentToDevice(att: ExportAttachment): Promise<ExportResult> {
  const kind = isVoiceMessage(att.contentType, att.filename) ? 'audio' : attachmentKind(att.contentType, att.filename);
  if (kind !== 'image' && kind !== 'video') return shareAttachment(att);
  let copy: File;
  try {
    const permission = await requestPermissionsAsync(true);
    if (!permission.granted) return { status: 'denied' };
    copy = await exportCopy(att);
  } catch (e) {
    return failure(e);
  }
  try {
    await Asset.create(copy.uri);
    try {
      copy.parentDirectory.delete();
    } catch {
      /* swept later */
    }
    return { status: 'saved' };
  } catch {
    return shareAttachment(att);
  }
}
