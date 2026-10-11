/**
 * The header of a nav-owned page on the content side (Friends, Notes, Home): on a phone it
 * starts with the "show spaces and rooms" button (MobileRailsOpenButton), the same as swiping
 * right; on a tablet the rails are already beside it, so the button is not there.
 */
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { useIsWide } from '@/shell/SwipeShell';
import { openNav } from '@/shell/state';
import { Header, Icon, IconButton, type HeaderAction } from '@/ui';

/** The hamburger back to the rails (phones only). */
export function RailsButton() {
  const wide = useIsWide();
  if (wide) return null;
  return <IconButton icon="fa-bars" label={t('mobile.nav.showRails')} onPress={openNav} size="lg" />;
}

export function ContentHeader({
  title,
  icon,
  actions,
  right,
}: {
  title: string;
  icon: string;
  actions?: HeaderAction[];
  right?: React.ReactNode;
}) {
  return (
    <Header
      title={title}
      actions={actions}
      right={right}
      leading={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <RailsButton />
          <Icon name={icon} size={16} tone="muted" />
        </View>
      }
    />
  );
}
