/**
 * The report form (the web's ReportDialog) as a bottom sheet, rendering the report presenter
 * (src/platform/presenters/reportSheet) that lib/userContextMenu's "Report", the message
 * actions and the profile screens open: who is being reported and where, one required
 * reason, optional details (with the reporter's own copy of an encrypted message offered as
 * a starting point - the instance cannot read it), then "Report sent". It can't be swiped
 * away while the report is being sent.
 */
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  canPasteReportMessage,
  dismissReportSheet,
  pasteReportMessage,
  reportMessageContext,
  reportReasonLabel,
  reportSheet,
  reportSheetTitle,
  setReportDetails,
  setReportReason,
  submitReport,
} from '@/platform/presenters';
import { Button, EmptyState, Icon, ListRow, Sheet, Text, TextArea, haptics } from '@/ui';
import { useTheme } from '@/theme';

export function ReportSheetHost() {
  const theme = useTheme();
  const state = useSolid(() => ({
    open: !!reportSheet.subject,
    reason: reportSheet.reason,
    details: reportSheet.details,
    busy: reportSheet.busy,
    error: reportSheet.error,
    sent: reportSheet.sent,
    title: reportSheetTitle(),
    context: reportMessageContext(),
    canPaste: canPasteReportMessage(),
  }));

  return (
    <Sheet
      open={state.open}
      onClose={() => void dismissReportSheet()}
      dismissible={!state.busy}
      title={state.sent ? undefined : state.title}
      description={state.sent ? undefined : t('report.description')}
      icon={state.sent ? undefined : 'flag'}
      tone="danger"
      scrollable
      testID="report-sheet"
    >
      {state.sent ? (
        <View style={{ gap: 16, paddingTop: 8 }}>
          <EmptyState icon="circle-check" title={t('report.sent')} body={t('report.sentBody')} />
          <Button title={t('common.close')} fullWidth onPress={() => void dismissReportSheet()} />
        </View>
      ) : (
        <View style={{ gap: 14, paddingTop: 8 }}>
          {state.context ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="message" size={12} tone="muted" />
              <Text variant="caption" style={{ flexShrink: 1 }}>
                {state.context}
              </Text>
            </View>
          ) : null}
          <View>
            <Text variant="overline" style={{ marginBottom: 4 }}>
              {t('report.reasonLabel')}
            </Text>
            <View accessibilityRole="radiogroup" style={{ borderRadius: theme.radii.lg, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' }}>
              {REPORT_REASONS.map((r) => (
                <ListRow
                  key={r}
                  title={reportReasonLabel(r)}
                  accessibilityRole="radio"
                  checked={state.reason === r}
                  selected={state.reason === r}
                  disabled={state.busy}
                  trailing={state.reason === r ? <Icon name="check" size={14} tone="primary" /> : null}
                  onPress={() => {
                    haptics.selection();
                    setReportReason(r);
                  }}
                />
              ))}
            </View>
          </View>
          <TextArea
            label={t('report.detailsLabel')}
            placeholder={t('report.detailsPlaceholder')}
            value={state.details}
            onChangeText={setReportDetails}
            maxLength={REPORT_DETAILS_MAX}
            disabled={state.busy}
            minRows={3}
            maxRows={8}
          />
          {state.canPaste ? (
            <View style={{ gap: 6 }}>
              <Text variant="caption">{t('report.detailsHint')}</Text>
              <Button title={t('report.pasteMessage')} icon="paste" variant="outline" size="sm" onPress={pasteReportMessage} />
            </View>
          ) : null}
          {state.error ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {state.error}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title={t('common.cancel')} variant="outline" style={{ flex: 1 }} disabled={state.busy} onPress={() => void dismissReportSheet()} />
            <Button
              title={t('report.submit')}
              variant="destructive"
              style={{ flex: 1 }}
              disabled={!state.reason || state.busy}
              loading={state.busy}
              onPress={() => void submitReport().then((ok) => ok && haptics.success())}
            />
          </View>
        </View>
      )}
    </Sheet>
  );
}
