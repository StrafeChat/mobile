/**
 * Presenters: tiny Solid stores for the app-wide sheets that shared web code opens, each drawn
 * by one host component mounted at the root of the app. Shared code reaches them through the
 * web's own entry points (stores/contextMenu, components/ReportDialog, stores/userProfilePopover
 * - overridden to land here); mobile UI calls the functions below directly. Each file documents
 * its state shape.
 */
export {
  actionSheet,
  actionSheetIconName,
  dismissActionSheet,
  presentActionSheet,
  selectActionSheetItem,
  type ActionSheetHeader,
  type ActionSheetState,
  type ContextMenuItem,
} from './actionSheet';
export {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  canPasteReportMessage,
  dismissReportSheet,
  pasteReportMessage,
  presentReportSheet,
  reportMessageContext,
  reportReasonLabel,
  reportRoomLabel,
  reportSheet,
  reportSheetTitle,
  setReportDetails,
  setReportReason,
  submitReport,
  type ReportReason,
  type ReportSheetState,
  type ReportSubject,
} from './reportSheet';
export {
  dismissProfileSheet,
  presentProfileSheet,
  presentProfileSheetForParticipant,
  profileSheet,
  type PresentProfileOptions,
  type ProfileSheetState,
} from './profileSheet';
