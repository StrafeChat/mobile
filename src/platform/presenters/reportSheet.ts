/**
 * The report sheet: reporting a user or a space to the instance's administrators.
 *
 * On the web this is components/ReportDialog.tsx - a Solid component holding both the form
 * state and the submit rules. Shared code opens it through `openReportDialog(subject)`
 * (lib/userContextMenu's "Report" item does); on mobile that call lands here
 * (overrides/components/ReportDialog.ts) and a native sheet host draws this state. The form
 * logic that lived in the component - one reason required, optional details, the reporter's
 * own copy of an encrypted message offered as a starting point, the 409/429 messages - lives
 * here so the host is only layout.
 *
 * State, read with `useSolid(() => ({ ...reportSheet }))` (or field by field):
 *
 *   {
 *     subject: ReportSubject | null; // null = closed
 *     reason: ReportReason | '';     // '' until one is picked; submit needs one
 *     details: string;               // free text, the host caps it at REPORT_DETAILS_MAX
 *     busy: boolean;                 // a submit is in flight: disable inputs, block dismissal
 *     error: string;                 // translated, '' when none
 *     sent: boolean;                 // submitted: show t('report.sent') / t('report.sentBody')
 *   }
 *
 * Strings the host needs: reportSheetTitle(), t('report.description') (hidden once sent),
 * reportMessageContext() (non-empty only when a message is cited), reportReasonLabel(r) for
 * each of REPORT_REASONS, t('report.detailsLabel' / 'report.detailsPlaceholder'),
 * t('report.detailsHint') + t('report.pasteMessage') while canPasteReportMessage(), and
 * t('report.submit') / t('common.cancel') / t('common.close').
 *
 * The server never receives message content from this flow unless the reporter pastes it into
 * the details themselves: an encrypted room's text is not the server's to read.
 */
import { createStore } from 'solid-js/store';
import { createReport } from '@web/api/reports';
import { REPORT_REASONS, type ReportReason } from '@web/api/instance';
import { ApiError } from '@web/api/ApiError';
import { auth } from '@web/stores/auth';
import { rooms, roomDisplayName } from '@web/stores/rooms';
import { spaces } from '@web/stores/spaces';
import { t } from '@web/i18n/t';

export { REPORT_REASONS };
export type { ReportReason };

/** Mirrors ReportSubject in web/src/components/ReportDialog.tsx. */
export interface ReportSubject {
  targetType: 'user' | 'space';
  targetId: string;
  /** Shown in the title so the person can see they are reporting the right thing. */
  targetName: string;
  /** Context an administrator will want: where it happened, and which message. */
  spaceId?: string;
  roomId?: string;
  roomName?: string;
  messageId?: string;
  /** The reporter's own copy of the message, offered as a starting point for the details. */
  messageText?: string;
}

export interface ReportSheetState {
  subject: ReportSubject | null;
  reason: ReportReason | '';
  details: string;
  busy: boolean;
  error: string;
  sent: boolean;
}

/** The web form's limit on the details field. */
export const REPORT_DETAILS_MAX = 2000;

const CLOSED: ReportSheetState = { subject: null, reason: '', details: '', busy: false, error: '', sent: false };

const [state, setState] = createStore<ReportSheetState>({ ...CLOSED });

export const reportSheet = state;

/** Open the sheet for `subject`, with an empty form. */
export function presentReportSheet(subject: ReportSubject): void {
  setState({ ...CLOSED, subject });
}

/** Close the sheet. Refused (returns false) while a submit is in flight. */
export function dismissReportSheet(): boolean {
  if (state.busy) return false;
  setState({ ...CLOSED });
  return true;
}

export function setReportReason(reason: ReportReason): void {
  if (state.busy) return;
  setState({ reason, error: '' });
}

export function setReportDetails(details: string): void {
  if (state.busy) return;
  setState('details', details.slice(0, REPORT_DETAILS_MAX));
}

/** Whether to offer pasting the reporter's copy of the cited message into the details. */
export function canPasteReportMessage(): boolean {
  return !!state.subject?.messageText && !state.details;
}

export function pasteReportMessage(): void {
  const text = state.subject?.messageText;
  if (text) setReportDetails(text);
}

export function reportReasonLabel(reason: ReportReason): string {
  return t(`report.reasons.${reason}`);
}

export function reportSheetTitle(): string {
  const s = state.subject;
  if (!s) return '';
  return s.targetType === 'space' ? t('report.titleSpace', { name: s.targetName }) : t('report.titleUser', { name: s.targetName });
}

/**
 * The room the cited message was in, named the way the room list names it: a message row
 * knows its room id, not its name.
 */
export function reportRoomLabel(): string {
  const s = state.subject;
  if (!s?.roomId) return '';
  if (s.roomName) return s.roomName;
  if (s.spaceId) return spaces.spaceRoomsBySpaceId[s.spaceId]?.find((r) => r.id === s.roomId)?.name ?? '';
  const r = rooms.rooms.find((x) => x.id === s.roomId);
  return r && auth.user?.id ? roomDisplayName(r, auth.user.id) : '';
}

/** "Reported message in <room>", or '' when no message is cited. */
export function reportMessageContext(): string {
  if (!state.subject?.messageId) return '';
  return t('report.messageContext', { room: reportRoomLabel() || t('common.unknown') });
}

/** File the report. Resolves true once it was accepted; on failure `error` says why. */
export async function submitReport(): Promise<boolean> {
  const s = state.subject;
  const reason = state.reason;
  if (!s || !reason || state.busy || state.sent) return false;
  setState({ busy: true, error: '' });
  try {
    await createReport({
      target_type: s.targetType,
      target_id: s.targetId,
      space_id: s.spaceId,
      room_id: s.roomId,
      message_id: s.messageId,
      reason,
      details: state.details.trim() || undefined,
    });
    // The sheet may have been replaced by another report meanwhile; only mark this one sent.
    if (state.subject === s) setState({ busy: false, sent: true });
    return true;
  } catch (err) {
    let error = t('report.failed');
    if (err instanceof ApiError && err.status === 409) error = t('report.duplicate');
    else if (err instanceof ApiError && err.status === 429) error = t('report.tooMany');
    if (state.subject === s) setState({ busy: false, error });
    return false;
  }
}
