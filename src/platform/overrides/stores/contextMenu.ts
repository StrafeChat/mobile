/**
 * Mobile replacement for web/src/stores/contextMenu.ts.
 *
 * The web positions a menu at the pointer of a right-click. On a phone the same items are an
 * action sheet (src/platform/presenters/actionSheet.ts); this keeps the web module's exports
 * so shared code that opens or reads the menu keeps working, and routes it to that sheet.
 *
 * Mobile UI should call presentActionSheet() from the presenter directly (it is typed for
 * phones: no event, an optional header). TypeScript resolves `@web/stores/contextMenu` to the
 * web original, whose showContextMenu() demands a MouseEvent.
 */
import { actionSheet, dismissActionSheet, presentActionSheet } from '../../presenters/actionSheet';
import type { ContextMenuItem } from '@web-original/stores/contextMenu';

export type { ContextMenuItem };

/** The web's menu state; a sheet has no position, so x and y are always 0. */
export function contextMenuState(): { open: boolean; x: number; y: number; items: ContextMenuItem[] } {
  const s = actionSheet();
  return { open: s.open, x: 0, y: 0, items: s.items };
}

/**
 * Open the menu. Accepts the web's `(event, items)` - the event, if any, is only stopped from
 * reaching anything else - and the phone's `(items)`.
 */
export function showContextMenu(items: ContextMenuItem[]): void;
export function showContextMenu(e: MouseEvent | { preventDefault?: () => void; stopPropagation?: () => void } | null | undefined, items: ContextMenuItem[]): void;
export function showContextMenu(
  a: ContextMenuItem[] | MouseEvent | { preventDefault?: () => void; stopPropagation?: () => void } | null | undefined,
  b?: ContextMenuItem[],
): void {
  if (Array.isArray(a)) {
    presentActionSheet(a);
    return;
  }
  a?.preventDefault?.();
  a?.stopPropagation?.();
  presentActionSheet(b ?? []);
}

export function closeContextMenu(): void {
  dismissActionSheet();
}
