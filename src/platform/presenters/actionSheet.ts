/**
 * The action sheet: the list of actions a long-press (or a "more" button) offers, drawn by
 * one host component at the root of the app.
 *
 * The web opens a context menu at the pointer on right-click (web/src/stores/contextMenu.ts).
 * A phone has neither, so the same item lists - built by the shared builders such as
 * lib/userContextMenu's buildUserMenuItems - are presented here and drawn as a bottom sheet.
 * The web's own showContextMenu() lands here as well (overrides/stores/contextMenu.ts), so web
 * code that opens a menu opens this sheet.
 *
 * State, read with `useSolid(() => actionSheet())`:
 *
 *   {
 *     open: boolean;            // false once dismissed; `items` stay so the host can animate out
 *     items: ContextMenuItem[]; // { label, icon?, onClick, disabled?, danger? } in display order
 *     title?: string;           // optional header: who or what the actions are about
 *     subtitle?: string;
 *     key: number;              // new on every presentation, to reset the host's per-sheet state
 *   }
 *
 * The host draws `danger` items in the destructive colour and `disabled` ones greyed and
 * inert, maps `icon` with actionSheetIconName(), and on a tap calls selectActionSheetItem(i)
 * rather than item.onClick itself: that closes the sheet *before* running the action, so an
 * action that presents something else (a confirm, the report sheet, another menu) is not
 * covered or closed by this one.
 */
import { createSignal } from 'solid-js';
import type { ContextMenuItem } from '@web/stores/contextMenu';
import { closeActionSheet, showActionSheet } from '@/ui/presenter';

export type { ContextMenuItem };

export interface ActionSheetState {
  open: boolean;
  items: ContextMenuItem[];
  title?: string;
  subtitle?: string;
  key: number;
}

export interface ActionSheetHeader {
  title?: string;
  subtitle?: string;
}

const [state, setState] = createSignal<ActionSheetState>({ open: false, items: [], key: 0 });

/**
 * The sheet's current state (a Solid accessor). Drawing is done by the design system's one
 * action-sheet host (src/ui/presenter.ts showActionSheet); this mirrors what it shows so
 * logic code can ask whether a menu is open.
 */
export const actionSheet = state;

/**
 * Present `items` as an action sheet. An empty list presents nothing. The UI host closes the
 * sheet before running the chosen item, so an action that opens something else (a confirm,
 * the report sheet) is not covered by this one.
 */
export function presentActionSheet(items: ContextMenuItem[], header?: ActionSheetHeader): void {
  if (items.length === 0) return;
  const key = state().key + 1;
  setState({
    open: true,
    items,
    ...(header?.title ? { title: header.title } : {}),
    ...(header?.subtitle ? { subtitle: header.subtitle } : {}),
    key,
  });
  void showActionSheet(items, {
    ...(header?.title ? { title: header.title } : {}),
    ...(header?.subtitle ? { subtitle: header.subtitle } : {}),
  }).finally(() => {
    setState((s) => (s.key === key ? { ...s, open: false } : s));
  });
}

/** Close the sheet (back gesture, backdrop tap, swipe down). */
export function dismissActionSheet(): void {
  closeActionSheet();
  setState((s) => (s.open ? { ...s, open: false } : s));
}

/** Run the item at `index` of the sheet on show: close first, then act. */
export function selectActionSheetItem(index: number): void {
  const s = state();
  const item = s.open ? s.items[index] : undefined;
  if (!item || item.disabled) return;
  dismissActionSheet();
  try {
    item.onClick();
  } catch (e) {
    console.error('[actionSheet] action failed', e);
  }
}

/**
 * The FontAwesome6 glyph name (@expo/vector-icons) for an item's `icon`. The shared builders
 * use the web's Font Awesome classes ('fa-copy', 'fa-solid fa-flag'); the glyph is the same.
 */
export function actionSheetIconName(icon: string | undefined): string | undefined {
  if (!icon) return undefined;
  const glyph = icon
    .split(/\s+/)
    .filter((c) => c.startsWith('fa-') && !/^fa-(solid|regular|light|thin|duotone|brands|sharp)$/.test(c))
    .pop();
  return glyph ? glyph.slice(3) : undefined;
}
