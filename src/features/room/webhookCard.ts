/**
 * The card a webhook's or a bridged message's name or avatar opens (the web's
 * stores/webhookCard + WebhookCard, as a bottom sheet). Never a person's profile: neither a
 * webhook nor a bridged person is an account, so nothing a person's sheet has (message, add
 * friend, roles, nickname, kick) is offered.
 *
 * Plain functions and a subscribable value, no React; the host (profile/WebhookCardSheet.tsx,
 * mounted by RoomHosts) renders it.
 */
import type { BridgedIdentity } from '@web/lib/webhookMessages';
import { createExternalStore } from '@/ui';

export interface WebhookCardSubject {
  /** The webhook (or bridge) that posted. */
  webhookId: string;
  name: string;
  avatar?: string;
  spaceId?: string | null;
  roomId?: string | null;
  /** A bridged person: their stable id (their default avatar, the block) and their bridge. */
  puppetId?: string;
  bridge?: BridgedIdentity;
  /** `#rrggbb`, when their bridge allows colours. */
  colour?: string;
}

export const webhookCardStore = createExternalStore<(WebhookCardSubject & { id: number }) | null>(null);

let seq = 0;

export function presentWebhookCard(subject: WebhookCardSubject): void {
  webhookCardStore.set({ ...subject, id: ++seq });
}

export function dismissWebhookCard(): void {
  webhookCardStore.set(null);
}
