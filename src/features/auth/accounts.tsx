/**
 * The accounts saved on this device (the desktop app's account list, which mobile reuses
 * through @/platform/session): one hook for the rows, the actions, and the two places they
 * show - the account switcher sheet for the You panel, and the "Your accounts" list on the
 * sign-in screen (where "Add an account" lands, so the way back must be right there).
 *
 * Every switch, add and sign-out restarts the app (session.ts): nothing of one account may
 * stay in memory for the next.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { confirmDialog } from '@web/stores/confirmDialog';
import { useSolid } from '@/bridge/solid';
import { activeAccountId, addAccount, forgetAccount, signOut, sortedAccounts, switchAccount } from '@/platform/session';
import { useTheme } from '@/theme';
import {
  Avatar,
  Button,
  Icon,
  IconButton,
  ListRow,
  Sheet,
  Spinner,
  Text,
  createExternalStore,
  haptics,
  showActionSheet,
  toast,
  useExternalStore,
  type ActionSheetEntry,
} from '@/ui';

export interface AccountRowView {
  id: string;
  displayName: string;
  username: string;
  domain: string;
  avatar?: string;
  active: boolean;
}

/** Saved accounts, active first then most recently used. */
export function useSavedAccounts(): readonly AccountRowView[] {
  return useSolid(() => {
    const active = activeAccountId();
    return sortedAccounts().map((a) => ({
      id: a.id,
      displayName: a.displayName || a.username,
      username: a.username,
      domain: a.instance.domain,
      ...(a.avatar ? { avatar: a.avatar } : {}),
      active: a.id === active,
    }));
  });
}

/** `@name · domain`, the line under an account's name (SavedAccounts.tsx). */
export function accountSubtitle(a: Pick<AccountRowView, 'username' | 'domain'>): string {
  return `@${a.username} · ${a.domain}`;
}

export async function confirmRemoveAccount(a: Pick<AccountRowView, 'id' | 'displayName' | 'domain'>): Promise<boolean> {
  const ok = await confirmDialog({
    title: t('desktop.accounts.remove'),
    body: t('desktop.accounts.removeConfirm', { name: a.displayName, domain: a.domain }),
    confirmLabel: t('desktop.accounts.remove'),
    tone: 'danger',
  });
  if (!ok) return false;
  try {
    await forgetAccount(a.id);
  } catch {
    toast.error(t('errors.unknown'));
    return false;
  }
  return true;
}

export async function confirmSignOut(): Promise<boolean> {
  const ok = await confirmDialog({
    title: t('desktop.accounts.signOut'),
    body: t('mobile.auth.signOutConfirm'),
    confirmLabel: t('desktop.accounts.signOut'),
    tone: 'danger',
    icon: 'fa-solid fa-right-from-bracket',
  });
  if (ok) await signOut();
  return ok;
}

/** The long-press / overflow menu of one account row. */
export function accountMenu(a: AccountRowView, onSwitch: (id: string) => void): ActionSheetEntry[] {
  return [
    !a.active && { key: 'switch', label: t('mobile.auth.switchTo'), icon: 'right-left', onSelect: () => onSwitch(a.id) },
    a.active && { key: 'signOut', label: t('desktop.accounts.signOut'), icon: 'right-from-bracket', danger: true, onSelect: () => void confirmSignOut() },
    { key: 'remove', label: t('desktop.accounts.remove'), icon: 'trash-can', danger: true, onSelect: () => void confirmRemoveAccount(a) },
  ];
}

function AccountAvatar({ a, size = 'lg' }: { a: AccountRowView; size?: 'md' | 'lg' }) {
  return <Avatar uri={a.avatar ?? null} name={a.displayName} size={size} />;
}

/**
 * "Your accounts" under the sign-in form: back into a saved account with one tap, or remove
 * it from this device.
 */
export function SavedAccountsList({ disabled }: { disabled?: boolean }) {
  const accounts = useSavedAccounts();
  const [switching, setSwitching] = useState<string | null>(null);
  if (!accounts.length) return null;

  const go = (id: string) => {
    if (switching) return;
    setSwitching(id);
    haptics.selection();
    void switchAccount(id).catch(() => setSwitching(null));
  };

  return (
    <View style={{ gap: 8 }} testID="saved-accounts">
      <View style={{ gap: 2, paddingHorizontal: 4 }}>
        <Text variant="overline">{t('desktop.accounts.saved')}</Text>
        <Text variant="caption">{t('mobile.auth.savedAccountsHint')}</Text>
      </View>
      <SavedAccountRows accounts={accounts} switching={switching} disabled={disabled} onSwitch={go} />
    </View>
  );
}

function SavedAccountRows({
  accounts,
  switching,
  disabled,
  onSwitch,
}: {
  accounts: readonly AccountRowView[];
  switching: string | null;
  disabled?: boolean;
  onSwitch: (id: string) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        overflow: 'hidden',
      }}
    >
      {accounts.map((a) => (
        <ListRow
          key={a.id}
          testID={`account-${a.id}`}
          title={a.displayName}
          subtitle={accountSubtitle(a)}
          leading={<AccountAvatar a={a} />}
          disabled={disabled || (!!switching && switching !== a.id)}
          onPress={a.active ? undefined : () => onSwitch(a.id)}
          onLongPress={() => {
            haptics.longPress();
            void showActionSheet(accountMenu(a, onSwitch), { title: a.displayName, subtitle: accountSubtitle(a) });
          }}
          accessibilityHint={a.active ? undefined : t('mobile.auth.switchTo')}
          trailing={
            switching === a.id ? (
              <Spinner size="small" decorative />
            ) : a.active ? (
              <Icon name="circle-check" size={18} tone="primary" accessibilityLabel={t('mobile.auth.activeAccount')} />
            ) : (
              <IconButton
                icon="fa-regular fa-trash-can"
                label={`${t('desktop.accounts.remove')}: ${a.displayName}`}
                tone="subtle"
                size="md"
                onPress={() => void confirmRemoveAccount(a)}
                testID={`account-remove-${a.id}`}
              />
            )
          }
        />
      ))}
    </View>
  );
}

// ---- the switcher sheet (You panel) ----------------------------------------------------------

const switcherStore = createExternalStore(false);
/** Mounted sheets driven by the store; without one, openAccountSwitcher() uses the action sheet. */
let hostsMounted = 0;

/** Open the account switcher (the You panel's "Switch accounts"). */
export function openAccountSwitcher(): void {
  haptics.selection();
  if (hostsMounted > 0) {
    switcherStore.set(true);
    return;
  }
  void showAccountSwitcherActionSheet();
}

export function closeAccountSwitcher(): void {
  switcherStore.set(false);
}

/** The same choices in the shared action sheet, for a tree with no switcher sheet mounted. */
export async function showAccountSwitcherActionSheet(): Promise<void> {
  const active = activeAccountId();
  const rows: AccountRowView[] = sortedAccounts().map((a) => ({
    id: a.id,
    displayName: a.displayName || a.username,
    username: a.username,
    domain: a.instance.domain,
    ...(a.avatar ? { avatar: a.avatar } : {}),
    active: a.id === active,
  }));
  await showActionSheet(
    [
      ...rows.map((a) => ({
        key: a.id,
        label: a.displayName,
        description: accountSubtitle(a),
        leading: <AccountAvatar a={a} size="md" />,
        selected: a.active,
        onSelect: a.active ? undefined : () => void switchAccount(a.id),
      })),
      'separator' as const,
      { key: 'add', label: t('desktop.accounts.add'), icon: 'user-plus', onSelect: () => void addAccount() },
    ],
    { title: t('desktop.accounts.switch') },
  );
}

export interface AccountSwitcherSheetProps {
  /** Controlled use. Leave both out to have openAccountSwitcher() drive it. */
  open?: boolean;
  onClose?: () => void;
}

/**
 * The account switcher: every account on this device, the active one checked; tap another to
 * become it, long-press (or "...") for sign out / remove; "Add an account" signs in to another
 * one and keeps this one. Mount it once (AuthHosts) for openAccountSwitcher(), or render it
 * controlled.
 */
export function AccountSwitcherSheet({ open: openProp, onClose }: AccountSwitcherSheetProps = {}) {
  const controlled = openProp !== undefined;
  const storeOpen = useExternalStore(switcherStore);
  const open = controlled ? openProp : storeOpen;
  const accounts = useSavedAccounts();
  const [busy, setBusy] = useState<string | null>(null);

  // Count store-driven instances so openAccountSwitcher() knows a sheet can show.
  useMountedHost(!controlled);

  const close = () => {
    if (controlled) onClose?.();
    else switcherStore.set(false);
  };

  const go = (id: string) => {
    if (busy) return;
    setBusy(id);
    haptics.selection();
    void switchAccount(id).catch(() => setBusy(null));
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('desktop.accounts.switch')}
      description={t('mobile.auth.switcherHint')}
      dismissible={!busy}
      scrollable
      testID="account-switcher"
    >
      <View style={{ gap: 16 }}>
        <SavedAccountRows accounts={accounts} switching={busy} onSwitch={go} />
        <Button
          title={t('desktop.accounts.add')}
          icon="user-plus"
          variant="secondary"
          fullWidth
          disabled={!!busy}
          onPress={() => {
            setBusy('add');
            void addAccount().catch(() => setBusy(null));
          }}
          testID="account-add"
        />
      </View>
    </Sheet>
  );
}


function useMountedHost(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    hostsMounted += 1;
    return () => {
      hostsMounted -= 1;
    };
  }, [active]);
}
