/**
 * ActionSheet: a list of actions in a bottom sheet - what a right-click context menu is on
 * the web (long-press a message, a member, a room, a space), and the picker behind Select.
 *
 * Use it declaratively (`<ActionSheet open entries onClose/>`) or, far more often, through the
 * presenter: `showActionSheet(entries, options)` from presenter.ts, rendered by the
 * `ActionSheetHost` that `<UiHosts/>` mounts. Item shape and handler timing are documented
 * there; in short the web's ContextMenuItem arrays work unchanged, handlers run after the
 * sheet has closed, and `submenu` items push a page inside the same sheet with a Back row.
 */
import { useEffect, useRef, useState } from 'react';
import { I18nManager, View } from 'react-native';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Divider } from './Divider';
import { haptics } from './haptics';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { Touchable } from './Touchable';
import { useExternalStore } from './externalStore';
import {
  actionSheetStore,
  cleanEntries,
  isActionItem,
  isActionSection,
  runActionItem,
  settleActionSheet,
  type ActionItem,
  type ActionSheetEntry,
  type ActionSheetOptions,
  type ActionSheetRequest,
} from './presenter';

export interface ActionSheetProps extends ActionSheetOptions {
  open: boolean;
  entries: readonly ActionSheetEntry[];
  /** After the sheet has closed: the chosen item (its handler has run) or null. */
  onClose: (item: ActionItem | null) => void;
  testID?: string;
}

interface Page {
  title: string;
  entries: readonly ActionSheetEntry[];
}

export function ActionSheet({ open, entries, onClose, title, subtitle, header, testID }: ActionSheetProps) {
  const theme = useTheme();
  const [pages, setPages] = useState<Page[]>([]);
  const [closing, setClosing] = useState(false);
  const chosen = useRef<ActionItem | null>(null);

  // Each opening starts on the root page with nothing chosen.
  useEffect(() => {
    if (!open) return;
    setPages([]);
    setClosing(false);
    chosen.current = null;
  }, [open]);

  const page = pages[pages.length - 1];
  const list = cleanEntries(page ? page.entries : entries);

  function choose(item: ActionItem) {
    if (item.disabled || closing) return;
    haptics.selection();
    if (item.submenu) {
      const sub = typeof item.submenu === 'function' ? item.submenu() : item.submenu;
      setPages((p) => [...p, { title: item.submenuTitle ?? item.label, entries: sub }]);
      return;
    }
    chosen.current = item;
    setClosing(true);
  }

  // `closing` stays set until the next opening: if the parent were slow to drop `open`, the
  // sheet must not spring back up in between.
  function handleClosed() {
    const item = chosen.current;
    chosen.current = null;
    if (item) runActionItem(item);
    onClose(item);
  }

  const showHeader = !page && (header || title || subtitle);

  return (
    <Sheet open={open && !closing} onClose={handleClosed} padded={false} scrollable testID={testID}>
      {showHeader ? (
        <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 2 }}>
          {header ?? (
            <>
              {title ? (
                <Text variant="heading" accessibilityRole="header" numberOfLines={2}>
                  {title}
                </Text>
              ) : null}
              {subtitle ? (
                <Text variant="caption" numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </>
          )}
        </View>
      ) : null}
      {page ? (
        <Touchable
          onPress={() => {
            haptics.selection();
            setPages((p) => p.slice(0, -1));
          }}
          accessibilityLabel={t('common.back')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 20 }}
        >
          <Icon name={I18nManager.isRTL ? 'chevron-right' : 'chevron-left'} size={15} tone="muted" />
          <Text variant="heading" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>
            {page.title}
          </Text>
        </Touchable>
      ) : null}
      {showHeader || page ? <Divider style={{ marginBottom: 6 }} /> : null}
      <View accessibilityRole="menu" style={{ paddingHorizontal: 8, paddingTop: showHeader || page ? 0 : 4 }}>
        {list.map((entry, i) => {
          if (entry === 'separator') return <Divider key={`sep-${i}`} subtle spacing={6} style={{ marginHorizontal: 12 }} />;
          if (isActionSection(entry)) {
            return (
              <Text key={`sec-${i}-${entry.section}`} variant="overline" accessibilityRole="header" style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 }}>
                {entry.section}
              </Text>
            );
          }
          if (!isActionItem(entry)) return null;
          return <ActionRow key={entry.key ?? `${i}-${entry.label}`} item={entry} onPress={() => choose(entry)} radius={theme.radii.md} />;
        })}
      </View>
    </Sheet>
  );
}

function ActionRow({ item, onPress, radius }: { item: ActionItem; onPress: () => void; radius: number }) {
  const theme = useTheme();
  const fg = item.danger ? theme.colors.destructive : theme.colors.foreground;
  const iconColor = item.iconColor ?? (item.danger ? theme.colors.destructive : theme.colors.mutedForeground);
  return (
    <Touchable
      testID={item.testID}
      onPress={onPress}
      disabled={item.disabled}
      accessibilityRole="menuitem"
      accessibilityLabel={item.description ? `${item.label}, ${item.description}` : item.label}
      accessibilityHint={item.accessibilityHint ?? (item.submenu ? t('mobile.ui.opensSubmenu') : undefined)}
      accessibilityState={{ disabled: !!item.disabled, selected: item.selected }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        minHeight: 48,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radius,
        opacity: item.disabled ? 0.45 : 1,
      }}
    >
      {item.leading ? (
        <View style={{ minWidth: 24, alignItems: 'center' }}>{item.leading}</View>
      ) : item.icon ? (
        <View style={{ width: 24, alignItems: 'center' }}>
          <Icon name={item.icon} size={17} color={iconColor} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" weight="medium" color={fg} numberOfLines={2} style={{ fontSize: theme.font(16) }}>
          {item.label}
        </Text>
        {item.description ? (
          <Text variant="caption" numberOfLines={3}>
            {item.description}
          </Text>
        ) : null}
      </View>
      {item.trailing ? (
        <Text variant="body" tone="muted" numberOfLines={1} style={{ maxWidth: '40%' }}>
          {item.trailing}
        </Text>
      ) : null}
      {item.selected ? <Icon name="check" size={16} tone="primary" /> : null}
      {item.submenu ? <Icon name={I18nManager.isRTL ? 'chevron-left' : 'chevron-right'} size={13} tone="muted" /> : null}
    </Touchable>
  );
}

/**
 * Renders `showActionSheet()` requests. Mounted once by `<UiHosts/>`, inside the
 * BottomSheetModalProvider.
 */
export function ActionSheetHost() {
  const req = useExternalStore(actionSheetStore);
  // The request on screen, kept mounted while it animates away after a programmatic close.
  const [shown, setShown] = useState<ActionSheetRequest | null>(req);
  useEffect(() => {
    if (req) setShown(req);
  }, [req]);
  if (!shown) return null;
  const open = !!req && req.id === shown.id;
  return (
    <ActionSheet
      key={shown.id}
      open={open}
      entries={shown.entries}
      title={shown.options.title}
      subtitle={shown.options.subtitle}
      header={shown.options.header}
      onClose={(item) => {
        settleActionSheet(shown.id, item);
        setShown((cur) => (cur?.id === shown.id ? null : cur));
      }}
    />
  );
}
