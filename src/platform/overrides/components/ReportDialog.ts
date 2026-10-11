/**
 * Mobile replacement for web/src/components/ReportDialog.tsx.
 *
 * The web module is a Solid component, which cannot load here; shared code only needs its
 * `openReportDialog` (lib/userContextMenu's "Report" item calls it). On mobile that presents
 * the native report sheet (src/platform/presenters/reportSheet.ts), whose host is mounted once
 * at the root of the app.
 */
import { presentReportSheet, type ReportSubject } from '../../presenters/reportSheet';

export type { ReportSubject };

/** Open the report form for a user or a space. */
export function openReportDialog(subject: ReportSubject): void {
  presentReportSheet(subject);
}

/**
 * The web's dialog component, kept only so this module exports what the original does. The
 * report UI on mobile is the native sheet host; nothing renders this.
 */
export function ReportDialog(): null {
  return null;
}
