/**
 * Moving around from the nav area: the expo-router screens it pushes and the shell moves it
 * makes.
 *
 * Routes are typed (experiments.typedRoutes), and the generated route table only knows the
 * screens that existed when it was last generated, so paths go through `as never` here in one
 * place - the same escape src/platform/wiring.ts uses.
 */
import { router } from 'expo-router';
import { addOrUpdateRoom } from '@web/stores/rooms';
import { createPM } from '@web/api/rooms';
import { t } from '@web/i18n/t';
import { openNav, openRoom, setSelectedSpaceId, setShellTab } from '@/shell/state';
import { toast } from '@/ui';

export function pushRoute(path: string): void {
  router.push(path as never);
}

export function replaceRoute(path: string): void {
  router.replace(path as never);
}

/** Leave a pushed screen: back when there is somewhere to go back to, else the shell. */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/' as never);
}

/** Return to the shell (the (main) stack's first screen) from any pushed screen. */
export function backToShell(): void {
  if (router.canDismiss()) router.dismissAll();
}

/**
 * Leave the pushed screen this is called from for the shell. A screen opened on its own - a
 * cold-start invite link - has no shell beneath it to dismiss to, so it is replaced by the
 * shell instead (backToShell alone would leave it on screen, its buttons doing nothing).
 */
export function closeScreenToShell(): void {
  if (router.canDismiss()) router.dismissAll();
  else replaceRoute('/');
}

/**
 * Show a space: its room list on the nav panel, on the Home tab - what the web does on
 * /spaces/:id (the space root shows the rails). Used after creating or joining a space;
 * `fromScreen` when called from a pushed screen (invite, Discover, create), which then closes
 * even when it was opened without the shell beneath.
 */
export function goToSpace(spaceId: string, opts: { fromScreen?: boolean } = {}): void {
  setSelectedSpaceId(spaceId);
  setShellTab('home');
  openNav();
  if (opts.fromScreen) closeScreenToShell();
  else backToShell();
}

/** Discover, from the rail's compass. */
export function openDiscover(): void {
  pushRoute('/discover');
}

/** The create-a-space screen (the rail's +). */
export function openCreateSpace(): void {
  pushRoute('/create-space');
}

/** The join-with-an-invite screen. */
export function openJoinSpace(): void {
  pushRoute('/join-space');
}

/** The invite preview for a code (`abc` or `abc@other.instance`). */
export function openInvite(code: string): void {
  pushRoute(`/invite/${encodeURIComponent(code)}`);
}

/**
 * The OAuth consent screen that installs a bot (settings area's /oauth2/authorize), with the
 * query the web's authorizeUrl builds - minus the origin, which the app does not need.
 */
export function openBotInstall(applicationId: string): void {
  const params = new URLSearchParams({ response_type: 'code', client_id: applicationId, scope: 'bot' });
  pushRoute(`/oauth2/authorize?${params.toString()}`);
}

/** Open (creating if needed) a 1:1 PM with someone and show it. */
export async function openPmWith(userId: string): Promise<void> {
  try {
    const room = await createPM(userId);
    addOrUpdateRoom(room);
    openRoom(room.id, null);
    backToShell();
  } catch {
    toast.error(t('mobile.nav.messageFailed'));
  }
}
