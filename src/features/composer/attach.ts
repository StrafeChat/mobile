/**
 * The composer's '+' menu: photos and videos from the library, the camera (photo or video),
 * files, and GIFs. Picks go into the room's attachment queue, which validates them with the
 * web's limits and messages (10 files, 25 MiB each, no empty files).
 */
import { Linking } from 'react-native';
import { t } from '@web/i18n/t';
import { showActionSheet, toast, type ActionSheetEntry } from '@/ui';
import { pickDocuments, pickFromLibrary, recordVideo, takePhoto, type AttachmentDraft, type PickResult } from '@/platform/media';
import { ATTACHMENTS_PER_MESSAGE } from '@web/lib/attachments/format';

/** Hand a picker's result to the queue, explaining a refusal or a failure. */
export async function handlePick(queue: AttachmentDraft, result: PickResult | null): Promise<void> {
  if (!result) return;
  switch (result.status) {
    case 'picked':
      await queue.addFiles(result.files);
      return;
    case 'cancelled':
      return;
    case 'denied':
      toast({
        message: t('mobile.media.cameraDenied'),
        tone: 'warning',
        action: { label: t('common.settings'), onPress: () => void Linking.openSettings() },
      });
      return;
    case 'failed':
      toast.error(t('mobile.media.pickFailed'));
  }
}

export function attachMenuEntries(opts: { queue: AttachmentDraft; onGif?: () => void }): ActionSheetEntry[] {
  const { queue } = opts;
  const free = () => Math.max(1, ATTACHMENTS_PER_MESSAGE - queue.items().length);
  return [
    {
      key: 'library',
      label: t('mobile.composer.photosVideos'),
      icon: 'images',
      onSelect: async () => handlePick(queue, await pickFromLibrary({ limit: free() })),
    },
    {
      key: 'camera',
      label: t('mobile.composer.takePhoto'),
      icon: 'camera',
      onSelect: async () => handlePick(queue, await takePhoto()),
    },
    {
      key: 'video',
      label: t('mobile.composer.recordVideo'),
      icon: 'video',
      onSelect: async () => handlePick(queue, await recordVideo()),
    },
    {
      key: 'files',
      label: t('mobile.composer.files'),
      icon: 'file',
      onSelect: async () => handlePick(queue, await pickDocuments({ multiple: true })),
    },
    opts.onGif ? { key: 'gif', label: t('gif.tab'), icon: 'film', onSelect: opts.onGif } : null,
  ];
}

export function openAttachMenu(opts: { queue: AttachmentDraft; onGif?: () => void }): void {
  void showActionSheet(attachMenuEntries(opts), { title: t('composer.attachFiles') });
}
