/**
 * Mobile replacement for web/src/lib/userContextMenu.ts - the web module itself, unchanged.
 *
 * The menu builders (buildUserMenuItems, buildSpaceModerationItems) are the shared rules for
 * which actions a user row or a message author offers, and run here as they are. What they
 * reach for that the app lacks is handled around them:
 *
 * - "Report" calls components/ReportDialog's openReportDialog, overridden to present the
 *   native report sheet (overrides/components/ReportDialog.ts);
 * - "Copy username" / "Copy user ID" write through `navigator.clipboard`, which ./clipboard
 *   installs on expo-clipboard before the builders can run;
 * - "Add to space" (bots) opens the consent screen through lib/openWindow, which goes to the
 *   app's own OAuth screen via desktop/native's openPopupWindow;
 * - "Block" confirms through stores/confirmDialog, which the app's host renders.
 *
 * The items they return are presented with presentActionSheet (src/platform/presenters/
 * actionSheet.ts).
 */
import './clipboard';

export * from '@web-original/lib/userContextMenu';
