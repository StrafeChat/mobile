/**
 * Dialog: a centred modal card for decisions that must be answered - confirms, alerts, a
 * short form. (Everything else is a Sheet.)
 *
 * It is the web ResponsiveDialog's look at its desktop breakpoint: backdrop of black 60 %, a
 * card with the web's large radius, the icon chip + title + description header, and the
 * actions in a row (stacked when there are more than two). It sits in a native Modal, so it
 * appears above sheets, the keyboard and everything else - right for "Delete this message?"
 * raised from inside an action sheet's handler.
 *
 * `DialogHost` (in `<UiHosts/>`) renders the shared web `confirmDialog()` store - the call
 * every shared module already makes before a destructive action - and the mobile
 * `showDialog()` / `alertDialog()` presenters, one at a time, the web prompt first.
 */
import { useEffect, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { confirmDialogState, settleConfirmDialog } from '@web/stores/confirmDialog';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Button, type ButtonVariant } from './Button';
import { DialogHeader } from './DialogHeader';
import { useExternalStore } from './externalStore';
import { haptics } from './haptics';
import { useReduceMotion } from './motion';
import { dialogStore, settleDialog, type DialogTone } from './presenter';
import { DIALOG_MAX_WIDTH, largeRadius } from './tokens';

export interface DialogButton {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

export interface DialogProps {
  open: boolean;
  /** Asked to close (backdrop, Android back) - only when dismissible. */
  onClose: () => void;
  title?: string;
  description?: string;
  icon?: string;
  tone?: DialogTone;
  /** Default true. False while a request runs. */
  dismissible?: boolean;
  /** Buttons in reading order; the last is the primary action. */
  actions?: DialogButton[];
  children?: ReactNode;
  testID?: string;
}

export function Dialog({ open, onClose, title, description, icon, tone = 'default', dismissible = true, actions, children, testID }: DialogProps) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 32, DIALOG_MAX_WIDTH);
  const stacked = (actions?.length ?? 0) > 2;
  const requestClose = () => {
    if (dismissible) onClose();
  };

  // A danger prompt is a moment to pause: a warning tap as it appears.
  useEffect(() => {
    if (open && tone === 'danger') haptics.warning();
  }, [open, tone]);

  return (
    <Modal
      visible={open}
      transparent
      animationType={reduce ? 'none' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={requestClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <Pressable
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }}
            onPress={requestClose}
            accessible={dismissible}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          />
          <View
            testID={testID}
            accessibilityViewIsModal
            style={{
              width: cardWidth,
              maxHeight: '85%',
              backgroundColor: theme.colors.card,
              borderRadius: largeRadius(theme.radii.xl),
              borderWidth: 1,
              borderColor: theme.colors.border,
              paddingHorizontal: 24,
              paddingTop: 24,
              paddingBottom: 20,
              shadowColor: '#000',
              shadowOpacity: 0.4,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 12 },
              elevation: 16,
            }}
          >
            <DialogHeader title={title} description={description} icon={icon} tone={tone} centered />
            {children}
            {actions?.length ? (
              <View style={[{ gap: 8, marginTop: 8 }, stacked ? null : { flexDirection: 'row' }]}>
                {(stacked ? [...actions].reverse() : actions).map((a, i) => (
                  <View key={`${i}-${a.label}`} style={stacked ? undefined : { flex: 1 }}>
                    <Button
                      title={a.label}
                      onPress={a.onPress}
                      variant={a.variant ?? 'primary'}
                      loading={a.loading}
                      disabled={a.disabled}
                      fullWidth
                      testID={a.testID}
                    />
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const DIALOG_VARIANT: Record<string, ButtonVariant> = {
  primary: 'primary',
  secondary: 'secondary',
  outline: 'outline',
  ghost: 'ghost',
  danger: 'danger',
};

/** Renders the web's `confirmDialog()` and the `showDialog()` queue. Mounted once. */
export function DialogHost() {
  const confirm = useSolid(() => {
    const p = confirmDialogState.pending;
    return p ? { ...p.options } : null;
  });
  const queue = useExternalStore(dialogStore);
  const head = queue[0];

  if (confirm) {
    const danger = confirm.tone === 'danger';
    return (
      <Dialog
        open
        testID="confirm-dialog"
        onClose={() => settleConfirmDialog(false)}
        title={confirm.title}
        description={confirm.body}
        icon={confirm.icon ?? (danger ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-question')}
        tone={danger ? 'danger' : 'default'}
        actions={[
          { label: confirm.cancelLabel ?? t('common.cancel'), variant: 'outline', onPress: () => settleConfirmDialog(false), testID: 'confirm-dialog-cancel' },
          {
            label: confirm.confirmLabel ?? t('common.confirm'),
            variant: danger ? 'danger' : 'primary',
            onPress: () => settleConfirmDialog(true),
            testID: 'confirm-dialog-confirm',
          },
        ]}
      />
    );
  }

  if (!head) return null;
  const o = head.options;
  const dismissible = o.dismissible !== false;
  // No key per request: the next queued dialog swaps into the same visible Modal. Unmounting
  // one Modal and presenting another in the same commit is what iOS refuses mid-animation.
  return (
    <Dialog
      open
      testID="presented-dialog"
      onClose={() => settleDialog(head.id, null)}
      dismissible={dismissible}
      title={o.title}
      description={o.body}
      icon={o.icon ?? (o.tone === 'danger' ? 'triangle-exclamation' : o.tone === 'warning' ? 'circle-exclamation' : undefined)}
      tone={o.tone}
      actions={o.actions.map((a) => ({
        label: a.label,
        variant: DIALOG_VARIANT[a.variant ?? 'primary'] ?? 'primary',
        onPress: () => settleDialog(head.id, a.value),
      }))}
    />
  );
}
