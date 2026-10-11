/**
 * Presenters: show an action sheet or a dialog from anywhere and await the answer.
 *
 * This is the mobile side of the web's app-wide overlays. On the web a right-click calls
 * `showContextMenu(e, items)` and one ContextMenu renders it; a destructive action awaits
 * `confirmDialog(...)`. Here a long-press calls `showActionSheet(items)` and the one
 * ActionSheetHost (in `<UiHosts/>`) renders it as a bottom sheet. No React in this module, so
 * store code and web-module overrides (src/platform/presenters/) can call it directly.
 *
 * ## The item shape
 *
 * `ActionItem` is a superset of the web's `ContextMenuItem` ({ label, icon, onClick,
 * disabled, danger }), so the web's shared menu builders' arrays can be passed as they are:
 *
 *   showActionSheet(buildUserMenuItems(...))          // ContextMenuItem[] - fine
 *
 * Beyond that: `description` (a second line), `selected` (a check mark - pickers),
 * `submenu` (pushes a page inside the same sheet, with a Back row), `leading` (an avatar or
 * swatch instead of an icon), `trailing` (a value or hint at the end). Entries can also be a
 * section label (`{ section: 'Moderation' }`), `'separator'`, or a falsy value - so a builder
 * can write `canKick && { label: ..., onSelect }` inline.
 *
 * ## When the handler runs
 *
 * After the sheet has closed, not on touch-down: the item's action often opens something
 * else (a confirm, another sheet, the keyboard), and starting that while the sheet is still
 * animating away is how overlays end up fighting. `onSelect` (or the web's `onClick`) is
 * called once, then the promise resolves with the chosen item. Dismissing without choosing
 * resolves `null`. A new sheet replaces an open one, which resolves `null` - the same rule as
 * the web's confirmDialog.
 */
import type { ReactNode } from 'react';
import { t } from '@web/i18n/t';
import { createExternalStore } from './externalStore';

export interface ActionItem {
  /** Stable key (defaults to the label). */
  key?: string;
  label: string;
  /** Second line under the label. */
  description?: string;
  /** Font Awesome icon: `fa-trash` (the web's menu items), `fa-solid fa-trash` or `trash`. */
  icon?: string;
  /** Icon colour override (a status colour, say). */
  iconColor?: string;
  /** Replaces the icon: an avatar, emoji or colour swatch. */
  leading?: ReactNode;
  /** Text at the end of the row (a current value, a count). */
  trailing?: string;
  /** Destructive: red label and icon. */
  danger?: boolean;
  disabled?: boolean;
  /** Draws a check mark (single-choice lists, the Select picker). */
  selected?: boolean;
  /** Runs after the sheet has closed. */
  onSelect?: () => unknown;
  /** The web's ContextMenuItem handler; called (with no event) when `onSelect` is absent. */
  onClick?: (e?: undefined) => void;
  /** Opens a nested page in the same sheet. A function is evaluated when the page opens. */
  submenu?: ActionSheetEntry[] | (() => ActionSheetEntry[]);
  /** Title of the nested page (defaults to the label). */
  submenuTitle?: string;
  accessibilityHint?: string;
  testID?: string;
}

/** A small uppercase group label inside a sheet ("Moderation"). */
export interface ActionSection {
  section: string;
}

export type ActionSheetEntry = ActionItem | ActionSection | 'separator' | null | undefined | false;

export interface ActionSheetOptions {
  /** Heading of the sheet (a user's name, "Message"). */
  title?: string;
  /** Second line under the title. */
  subtitle?: string;
  /** Custom header (avatar + name + tag) instead of title/subtitle. */
  header?: ReactNode;
}

export function isActionItem(e: ActionSheetEntry): e is ActionItem {
  return !!e && typeof e === 'object' && 'label' in e;
}

export function isActionSection(e: ActionSheetEntry): e is ActionSection {
  return !!e && typeof e === 'object' && 'section' in e;
}

/** Drop falsy entries, separators at the edges and repeated separators. */
export function cleanEntries(entries: readonly ActionSheetEntry[]): Exclude<ActionSheetEntry, null | undefined | false>[] {
  const out: Exclude<ActionSheetEntry, null | undefined | false>[] = [];
  for (const e of entries) {
    if (!e) continue;
    if (e === 'separator' && (out.length === 0 || out[out.length - 1] === 'separator')) continue;
    out.push(e);
  }
  while (out.length && out[out.length - 1] === 'separator') out.pop();
  return out;
}

/** Run an item's handler; errors are reported, never thrown into the sheet. */
export function runActionItem(item: ActionItem): void {
  try {
    const r = item.onSelect ? item.onSelect() : item.onClick?.();
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      (r as Promise<unknown>).then(undefined, (e: unknown) => console.error('[ui] action failed', e));
    }
  } catch (e) {
    console.error('[ui] action failed', e);
  }
}

// ---- action sheets -----------------------------------------------------------------------------

export interface ActionSheetRequest {
  id: number;
  entries: readonly ActionSheetEntry[];
  options: ActionSheetOptions;
  resolve: (item: ActionItem | null) => void;
}

export const actionSheetStore = createExternalStore<ActionSheetRequest | null>(null);
let sheetSeq = 0;

/**
 * Show an action sheet; resolves with the chosen item (after its handler ran) or null.
 *
 *   onLongPress={() => showActionSheet(items, { title: name })}
 *   const pick = await showActionSheet(options.map(...), { title: t('...') });
 */
export function showActionSheet(entries: readonly ActionSheetEntry[], options: ActionSheetOptions = {}): Promise<ActionItem | null> {
  // Nothing to offer (every item was conditional and none applied): no empty sheet.
  if (!cleanEntries(entries).some(isActionItem)) return Promise.resolve(null);
  return new Promise((resolve) => {
    actionSheetStore.get()?.resolve(null);
    actionSheetStore.set({ id: ++sheetSeq, entries, options, resolve });
  });
}

/** Close the open action sheet without a choice. */
export function closeActionSheet(): void {
  const cur = actionSheetStore.get();
  if (!cur) return;
  actionSheetStore.set(null);
  cur.resolve(null);
}

/** Host side: the sheet with `id` has closed with `item` (handler already run). */
export function settleActionSheet(id: number, item: ActionItem | null): void {
  const cur = actionSheetStore.get();
  if (!cur || cur.id !== id) return;
  actionSheetStore.set(null);
  cur.resolve(item);
}

// ---- dialogs -------------------------------------------------------------------------------------

export type DialogTone = 'default' | 'warning' | 'danger';
export type DialogButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

export interface DialogAction<T> {
  label: string;
  value: T;
  variant?: DialogButtonVariant;
}

export interface DialogOptions<T> {
  title: string;
  body?: string;
  /** Font Awesome icon for the chip beside the title; defaults per tone. */
  icon?: string;
  tone?: DialogTone;
  /** Buttons, in reading order (the last is the primary action). */
  actions: DialogAction<T>[];
  /** Backdrop tap / Android back resolves null. Default true. */
  dismissible?: boolean;
}

export interface DialogRequest {
  id: number;
  options: DialogOptions<unknown>;
  resolve: (value: unknown) => void;
}

/** Queued, not replaced: an alert raised while another is open waits its turn. */
export const dialogStore = createExternalStore<readonly DialogRequest[]>([]);
let dialogSeq = 0;

/**
 * A centred dialog with arbitrary buttons; resolves with the pressed action's value, or null
 * when dismissed. For yes/no confirms prefer the shared web `confirmDialog()` - it is what
 * the shared code calls, and the same host renders it.
 */
export function showDialog<T>(options: DialogOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const req: DialogRequest = { id: ++dialogSeq, options: options as DialogOptions<unknown>, resolve: resolve as (v: unknown) => void };
    dialogStore.set((q) => [...q, req]);
  });
}

/** Host side: the dialog `id` was answered (`null` = dismissed). */
export function settleDialog(id: number, value: unknown): void {
  const q = dialogStore.get();
  const req = q.find((r) => r.id === id);
  if (!req) return;
  dialogStore.set(q.filter((r) => r.id !== id));
  req.resolve(value);
}

/** A one-button notice ("Got it"); resolves when it is closed either way. */
export function alertDialog(title: string, body?: string, options: { okLabel?: string; icon?: string; tone?: DialogTone } = {}): Promise<void> {
  return showDialog({
    title,
    body,
    icon: options.icon,
    tone: options.tone,
    actions: [{ label: options.okLabel ?? t('common.gotIt'), value: true, variant: 'primary' }],
  }).then(() => undefined);
}
