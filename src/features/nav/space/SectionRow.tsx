/**
 * A section header in a space's list: chevron, the uppercase name, a primary dot while
 * collapsed over unread or mentioned rooms, and "+" to create a room in it for someone with
 * Manage Rooms. Tap collapses (remembered per device under the web's key); long-press opens the
 * section menu.
 */
import { memo } from 'react';
import { I18nManager, StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { spaces } from '@web/stores/spaces';
import { useSolid } from '@/bridge/solid';
import { toggleSectionCollapsed, useSpaceAbilities } from '@/data';
import { useTheme } from '@/theme';
import { Icon, IconButton, Text, Touchable, haptics, useLongPressActions } from '@/ui';
import { sectionMenuEntries } from '../menus';
import { openCreateRoomSheet } from '../sheets/store';

export const SectionRow = memo(function SectionRow({
  spaceId,
  sectionId,
  collapsed,
  hasUnread,
}: {
  spaceId: string;
  sectionId: string;
  collapsed: boolean;
  hasUnread: boolean;
}) {
  const theme = useTheme();
  const rawName = useSolid(
    () => spaces.spaceRoomsBySpaceId[spaceId]?.find((r) => r.id === sectionId)?.name ?? '',
    [spaceId, sectionId],
  );
  const name = rawName || t('space.unnamed');
  const abilities = useSpaceAbilities(spaceId);
  const menu = useLongPressActions(() => sectionMenuEntries(spaceId, sectionId), { title: name });
  const label = [name, collapsed && hasUnread ? t('mobile.nav.unread') : null].filter(Boolean).join(', ');
  return (
    <View style={styles.row}>
      <Touchable
        feedback="opacity"
        onPress={() => {
          haptics.selection();
          toggleSectionCollapsed(sectionId);
        }}
        accessibilityLabel={label}
        accessibilityState={{ expanded: !collapsed }}
        hitSlop={{ top: 4, bottom: 4 }}
        style={styles.toggle}
        {...menu}
      >
        <Icon
          name="fa-chevron-down"
          size={9}
          tone="muted"
          style={{ transform: [{ rotate: collapsed ? (I18nManager.isRTL ? '90deg' : '-90deg') : '0deg' }] }}
        />
        <Text variant="overline" numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        {collapsed && hasUnread ? <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} /> : null}
      </Touchable>
      {abilities.canManageRooms ? (
        <IconButton
          icon="fa-plus"
          size="sm"
          tone="subtle"
          label={t('space.createRoomIn', { name })}
          onPress={() => openCreateRoomSheet(spaceId, sectionId)}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingStart: 10, paddingEnd: 6, marginTop: 10 },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 6 },
  name: { flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
