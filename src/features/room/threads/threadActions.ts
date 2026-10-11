/**
 * A thread's own actions (the web's thread menu): Join or Leave for anyone; Rename and
 * Archive/Unarchive for the thread's owner or Manage Threads; Lock/Unlock and Delete for
 * Manage Threads. Rename asks for the name in a sheet (the web uses window.prompt) and keeps
 * it plain text, the way the create form does.
 */
import { MAX_THREAD_NAME_LENGTH, deleteThread, joinThread, leaveThread, updateThread } from '@web/api/threads';
import type { SpaceRoom } from '@web/api/spaces';
import { confirmDialog } from '@web/stores/confirmDialog';
import { spaceMembers } from '@web/stores/spaceMembers';
import { auth } from '@web/stores/auth';
import { messagePreviewText } from '@web/components/messageList/utils';
import { t } from '@web/i18n/t';
import { toast, type ActionSheetEntry } from '@/ui';
import { promptText } from '../presenters';
import { errorMessage } from '../util';

export interface ThreadActionContext {
  spaceId: string;
  canManageThreads: boolean;
  /** After a delete: where to go (the parent channel, if known). */
  onDeleted: (parentId: string | undefined) => void;
}

type ThreadLike = Pick<SpaceRoom, 'id' | 'name' | 'parent_id' | 'thread'>;

/** A thread name as plain text: mention / emoji syntax becomes its readable form. */
export function plainThreadName(raw: string, spaceId: string): string {
  return messagePreviewText(raw.trim(), spaceMembers.bySpaceId[spaceId] ?? [], auth.user?.id, 1000)
    .slice(0, MAX_THREAD_NAME_LENGTH)
    .trim();
}

function fail(e: unknown) {
  toast.error(errorMessage(e));
}

export function threadActionEntries(room: ThreadLike, ctx: ThreadActionContext): ActionSheetEntry[] {
  const th = room.thread;
  const owner = !!th && th.owner_id === auth.user?.id;
  const manage = ctx.canManageThreads;
  return [
    {
      label: th?.joined ? t('threads.leave') : t('threads.join'),
      icon: th?.joined ? 'right-from-bracket' : 'right-to-bracket',
      onSelect: () => void (th?.joined ? leaveThread(room.id) : joinThread(room.id)).catch(fail),
    },
    (manage || owner) && {
      label: t('threads.rename'),
      icon: 'pen',
      onSelect: async () => {
        const typed = await promptText({
          title: t('threads.rename'),
          label: t('threads.renamePrompt'),
          initial: room.name,
          maxLength: MAX_THREAD_NAME_LENGTH,
          confirmLabel: t('common.save'),
        });
        const next = typed ? plainThreadName(typed, ctx.spaceId) : '';
        if (next && next !== room.name) await updateThread(room.id, { name: next }).catch(fail);
      },
    },
    (manage || owner) && {
      label: th?.archived ? t('threads.unarchive') : t('threads.archive'),
      icon: th?.archived ? 'box-open' : 'box-archive',
      onSelect: () => void updateThread(room.id, { archived: !th?.archived }).catch(fail),
    },
    manage && {
      label: th?.locked ? t('threads.unlock') : t('threads.lock'),
      icon: th?.locked ? 'lock-open' : 'lock',
      onSelect: () => void updateThread(room.id, { locked: !th?.locked }).catch(fail),
    },
    manage && {
      label: t('threads.delete'),
      icon: 'trash',
      danger: true,
      onSelect: async () => {
        const ok = await confirmDialog({
          title: t('threads.delete'),
          body: t('threads.deleteConfirm', { name: room.name }),
          confirmLabel: t('threads.delete'),
          tone: 'danger',
        });
        if (!ok) return;
        try {
          await deleteThread(room.id);
          ctx.onDeleted(room.parent_id);
        } catch (e) {
          fail(e);
        }
      },
    },
  ];
}
