/**
 * Date of birth for registration (the web's DatePickerField), with the platform's own date
 * picker: Material's calendar dialog on Android, the wheel in a sheet on iOS. Nothing after
 * today can be picked, it opens about 18 years back when empty, and the value is the web's
 * 'YYYY-MM-DD' (a local calendar day). The 13-and-over rule is the form's (validation.ts).
 */
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { currentLanguage, formatDate, t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Button, FieldError, FieldLabel, Icon, Sheet, Text, Touchable, fieldBoxStyle } from '@/ui';
import { defaultPickerDate, parseISODate, toISODate } from '../logic/validation';

const EARLIEST = new Date(1900, 0, 1);

export interface DateOfBirthFieldProps {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function DateOfBirthField({ label, value, onChange, error, required, disabled, testID }: DateOfBirthFieldProps) {
  const theme = useTheme();
  const language = useSolid(() => currentLanguage());
  const [open, setOpen] = useState(false);
  const picked = parseISODate(value);
  const [draft, setDraft] = useState<Date>(() => picked ?? defaultPickerDate());
  const today = new Date();
  const shown = picked ? formatDate(picked, { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  const openPicker = () => {
    if (disabled) return;
    setDraft(picked ?? defaultPickerDate());
    setOpen(true);
  };

  const commit = (d: Date) => {
    setOpen(false);
    onChange(toISODate(d));
  };

  return (
    <View style={{ gap: 6, alignSelf: 'stretch' }}>
      <FieldLabel label={label} required={required} />
      <Touchable
        onPress={openPicker}
        disabled={disabled}
        feedback="opacity"
        accessibilityRole="button"
        accessibilityLabel={`${label}${required ? `, ${t('mobile.ui.required')}` : ''}`}
        accessibilityValue={{ text: shown || t('mobile.auth.dobPlaceholder') }}
        accessibilityHint={error || undefined}
        testID={testID}
        style={[
          { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 12, gap: 10 },
          fieldBoxStyle(theme, { focused: open, error: !!error, disabled }),
        ]}
      >
        <Icon name="cake-candles" size={14} tone="muted" />
        <Text variant="body" tone={shown ? 'default' : 'muted'} style={{ flex: 1 }} numberOfLines={1}>
          {shown || t('mobile.auth.dobPlaceholder')}
        </Text>
        <Icon name="calendar" iconStyle="regular" size={14} tone="muted" />
      </Touchable>
      <FieldError message={error} />

      {open && Platform.OS === 'android' ? (
        <DateTimePicker
          value={draft}
          mode="date"
          presentation="dialog"
          minimumDate={EARLIEST}
          maximumDate={today}
          accentColor={theme.colors.primary}
          positiveButton={{ label: t('common.done') }}
          negativeButton={{ label: t('common.cancel') }}
          onValueChange={(_e, d) => commit(d)}
          onDismiss={() => setOpen(false)}
        />
      ) : null}

      {Platform.OS !== 'android' ? (
        <Sheet open={open} onClose={() => setOpen(false)} title={label}>
          <View style={{ gap: 16, alignItems: 'center' }}>
            <DateTimePicker
              value={draft}
              mode="date"
              display="spinner"
              minimumDate={EARLIEST}
              maximumDate={today}
              accentColor={theme.colors.primary}
              themeVariant={theme.dark ? 'dark' : 'light'}
              locale={language.replace('-', '_')}
              onValueChange={(_e, d) => setDraft(d)}
              style={{ alignSelf: 'stretch' }}
            />
            <Button title={t('common.done')} fullWidth onPress={() => commit(draft)} testID={testID ? `${testID}-done` : undefined} />
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}
