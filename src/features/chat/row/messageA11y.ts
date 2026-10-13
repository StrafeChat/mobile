/**
 * What a screen reader can do inside a message's text.
 *
 * On iOS a message's header and text are one accessibility element (MessageRow), read as
 * "name, time: text", so VoiceOver does not walk into anything drawn inside the text: its
 * links, mentions and room pills, nor what renders under a link or as a block - an image or
 * GIF, an invite card, a code block's Copy, a preview card. Each becomes an action of that
 * element instead, in the actions rotor, doing what a tap on it does: "Open image: …" (the
 * viewer), "Open invite page" (the invite in the app, where the card's Join is), "Copy code",
 * "Open profile: …", "Go to #…", and "Open link: …" for any other link - a video link or one
 * with a preview card included, which opens the page itself. (TalkBack lists the same entries
 * in its actions menu.) Attachments, the thread strip and the reactions are outside that
 * element and stay reachable on their own.
 *
 * VoiceOver hands an activated action back by its label, and React Native runs the first action
 * with that label, so two actions that read alike would both run the first: every label is
 * made unique (`distinctLabels`).
 */
import * as Clipboard from 'expo-clipboard';
import type { MessageSegment } from '@web/lib/utils/markdown';
import { walkSegments } from '@web/lib/utils/markdown';
import { getMediaDimensions, hasRecentMediaFailure } from '@web/lib/mediaDimensions';
import { formatHandle } from '@web/stores/instance';
import { spaces } from '@web/stores/spaces';
import { t } from '@web/i18n/t';
import { userDisplay } from '@/data';
import { haptics, toast } from '@/ui';
import { linkEmbedOf, mediaFilename, parseBody } from '../body/bodyModel';
import { openMedia } from '../mediaViewer';
import { navigateToRoom, openInvitePage, openMessageLink } from '../navigation';
import { openUserProfile } from '../people';

export type BodyTarget =
  | { kind: 'link'; href: string; label: string }
  /** An image or GIF shown under its link: the viewer, as a tap on the picture. */
  | { kind: 'media'; href: string; label: string }
  /** A link with an invite card: the invite page, which has the card's Join. */
  | { kind: 'invite'; code: string; label: string }
  | { kind: 'code'; content: string; label: string }
  | { kind: 'profile'; userId: string; label: string }
  | { kind: 'room'; roomId: string; spaceId: string; label: string };

function roomOf(roomId: string): { spaceId: string; name: string } | null {
  for (const [spaceId, list] of Object.entries(spaces.spaceRoomsBySpaceId)) {
    const r = list?.find((x) => x.id === roomId);
    if (r) return { spaceId, name: r.name || 'unnamed' };
  }
  return null;
}

function hostOf(href: string): string | undefined {
  try {
    return new URL(href).host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * `labels`, each made unique. A label that repeats (among the others or `reserved`, the labels
 * the element's other actions already use) gets the first of its `details` that tells the
 * repeats apart - "Open link: docs (a.example)", then "(https://a.example/x)" if the hosts are
 * the same too - and an ordinal, "(2)", when none does.
 */
export function distinctLabels(labels: readonly string[], details: readonly (readonly string[])[], reserved: readonly string[] = []): string[] {
  let out = [...labels];
  const depth = Math.max(0, ...details.map((d) => d.length));
  for (let level = 0; level < depth; level++) {
    const counts = new Map<string, number>();
    for (const l of [...reserved, ...out]) counts.set(l, (counts.get(l) ?? 0) + 1);
    out = out.map((label, i) => {
      const detail = details[i]?.[level];
      return (counts.get(label) ?? 0) > 1 && detail ? `${labels[i]} (${detail})` : label;
    });
  }
  const used = new Set(reserved);
  return out.map((label) => {
    let unique = label;
    for (let n = 2; used.has(unique); n++) unique = `${label} (${n})`;
    used.add(unique);
    return unique;
  });
}

/**
 * The tappable things in a message's text, in reading order, each once: links (with what
 * renders under them), code blocks, people mentioned (not `skipUserId`, the author, whose
 * profile the row offers already) and rooms that are yours to open. `reserved` are the labels
 * of the element's own actions, which no target may repeat. Names are read when called (the
 * caller memoises per text).
 */
export function bodyTargets(
  text: string,
  ctx: { roomId: string; spaceId: string | null },
  skipUserId?: string,
  reserved: readonly string[] = [],
): BodyTarget[] {
  const out: BodyTarget[] = [];
  /** What tells apart two targets that read alike, most readable first. */
  const details: string[][] = [];
  const add = (target: BodyTarget, ...detail: (string | undefined)[]) => {
    out.push(target);
    details.push(detail.filter((d): d is string => !!d));
  };
  const seen = new Set<string>(skipUserId ? [`u:${skipUserId}`] : []);
  walkSegments(parseBody(text) as MessageSegment[], (seg) => {
    if (seg.type === 'link') {
      if (seen.has(`l:${seg.href}`)) return;
      seen.add(`l:${seg.href}`);
      const embed = linkEmbedOf(seg);
      if (embed?.kind === 'invite') {
        add({ kind: 'invite', code: embed.code, label: t('invite.openPage') }, embed.code);
      } else if (embed?.kind === 'media' && embed.media !== 'video' && !hasRecentMediaFailure(seg.href)) {
        // A video plays in place, which no action can reach; it opens as a link. So does a
        // picture known not to load: its embed has turned back into the link or a card.
        const name = seg.text && seg.text !== seg.href ? seg.text : mediaFilename(seg.href);
        add({ kind: 'media', href: seg.href, label: t('mobile.chat.link.openImage', { name }) }, hostOf(seg.href), seg.href);
      } else {
        add({ kind: 'link', href: seg.href, label: t('mobile.chat.link.openNamed', { link: seg.text || seg.href }) }, hostOf(seg.href), seg.href);
      }
    } else if (seg.type === 'codeBlock') {
      add({ kind: 'code', content: seg.content, label: t('mobile.chat.copyCode') }, seg.lang);
    } else if (seg.type === 'mention') {
      if (seen.has(`u:${seg.userId}`)) return;
      seen.add(`u:${seg.userId}`);
      const who = userDisplay(seg.userId, ctx);
      const name = who.name || t('common.unknown');
      // Display names are not unique; the handle is.
      const handle = who.username ? formatHandle({ username: who.username, ...(who.homeDomain ? { home_domain: who.homeDomain } : {}) }) : undefined;
      add({ kind: 'profile', userId: seg.userId, label: t('mobile.chat.openProfileOf', { name: `@${name}` }) }, handle);
    } else if (seg.type === 'channelMention') {
      if (seen.has(`r:${seg.roomId}`)) return;
      seen.add(`r:${seg.roomId}`);
      // An unknown room's pill only says it is unavailable; there is nothing to open.
      const room = roomOf(seg.roomId);
      if (room) {
        // Two spaces can each have a #general.
        const spaceName = spaces.spaces.find((s) => s.id === room.spaceId)?.name;
        add({ kind: 'room', roomId: seg.roomId, spaceId: room.spaceId, label: t('messages.goToRoom', { name: room.name }) }, spaceName);
      }
    }
  });
  const labels = distinctLabels(out.map((target) => target.label), details, reserved);
  return out.map((target, i) => ({ ...target, label: labels[i]! }));
}

/** The accessibility action name of the `i`th target ("body:3"), and back. */
export function bodyActionName(i: number): string {
  return `body:${i}`;
}

export function bodyActionIndex(name: string): number | null {
  const m = /^body:(\d+)$/.exec(name);
  return m ? Number(m[1]) : null;
}

/** The block's Copy button shows "Copied" on itself; from an action, the toast says it. */
async function copyCode(content: string): Promise<void> {
  try {
    await Clipboard.setStringAsync(content);
    haptics.success();
    toast(t('common.copied'));
  } catch {
    /* clipboard refused - nothing useful to say */
  }
}

/** Do what tapping the target in the text does. */
export function activateBodyTarget(target: BodyTarget, ctx: { roomId: string; spaceId: string | null }): void {
  switch (target.kind) {
    case 'link':
      openMessageLink(target.href);
      return;
    case 'media': {
      const dims = getMediaDimensions(target.href);
      openMedia([{ url: target.href, filename: mediaFilename(target.href), width: dims?.width, height: dims?.height }]);
      return;
    }
    case 'invite':
      openInvitePage(target.code);
      return;
    case 'code':
      void copyCode(target.content);
      return;
    case 'profile':
      openUserProfile(target.userId, ctx);
      return;
    case 'room':
      navigateToRoom(target.roomId, target.spaceId);
  }
}
