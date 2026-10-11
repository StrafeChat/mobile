/**
 * Mobile replacement for web/src/stores/mobileShellLayout.ts.
 *
 * The web's mobile layout state (which pager panel is in front, the bottom tab, the member
 * drawer) is, in the app, the native shell's state - src/shell/state.ts. Rather than a second
 * copy that would disagree with what is on screen, the web names are bound to the shell's
 * signals: anything that calls openMobileRoom() or reads mobilePanel() moves or reads the real
 * shell. The web module itself would also evaluate a media query at import; this one does not
 * need to.
 *
 * The finger-tracking pair (swipeOffset / swiping) is kept as inert signals: the native shell
 * animates on the UI thread and never publishes a per-frame offset to JS.
 */
import { createSignal } from 'solid-js';
import { Dimensions } from 'react-native';
import {
  openContent,
  openNav,
  setMembersAvailable,
  setMembersOpen,
  setShellPanel,
  setShellTab,
  shell,
  type ShellPanel,
  type ShellTab,
} from '../../../shell/state';

export type MobilePanel = ShellPanel;
export type MobileTab = ShellTab;

/** Tablet width, where the web stops paging - the native shell's WIDE_BREAKPOINT. */
const MD_PX = 768;

export const [isMdViewport, setIsMdViewport] = createSignal(Dimensions.get('window').width >= MD_PX);
Dimensions.addEventListener('change', ({ window }) => setIsMdViewport(window.width >= MD_PX));

export const mobilePanel = shell.panel;
export const setMobilePanel = setShellPanel;
export const mobileTab = shell.tab;
export const setMobileTab = setShellTab;

export const [swipeOffset, setSwipeOffset] = createSignal(0);
export const [swiping, setSwiping] = createSignal(false);

export const mobileMembersOpen = shell.membersOpen;
export const setMobileMembersOpen = setMembersOpen;
export const mobileMembersAvailable = shell.membersAvailable;
export const setMobileMembersAvailable = setMembersAvailable;

export const mobileNavFocus = (): 'rails' | 'content' => (mobilePanel() === 'nav' ? 'rails' : 'content');

export function openMobileRails(): void {
  openNav();
}

export function openMobileContent(): void {
  openContent();
}

/** Tapping a notification / conversation: the conversation in front, on the Home tab. */
export function openMobileRoom(): void {
  setShellTab('home');
  setMembersOpen(false);
  setShellPanel('content');
}
