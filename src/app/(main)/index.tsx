/**
 * The app shell: rails ⟷ conversation ⟷ members (src/shell/SwipeShell.tsx).
 *
 * TEMPORARY panels: they list real data from the stores to prove the platform layer end to
 * end (gateway READY, spaces, PMs, the E2EE engine). The nav, conversation and member panels
 * from src/features replace them.
 */
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { useMe, usePmRoomIds, usePmRow, useSpaceIds, useSpace } from '@/data';
import { cryptoHost } from '@/platform/crypto';
import { signOut } from '@/platform/session';
import { SwipeShell } from '@/shell/SwipeShell';
import { openRoom, shell } from '@/shell/state';
import { Button, Text } from '@/ui';
import { useTheme } from '@/theme';
import { useEffect, useState } from 'react';

function PmRow({ id }: { id: string }) {
  const row = usePmRow(id, null);
  if (!row) return null;
  return (
    <Pressable onPress={() => openRoom(id, null)} style={{ paddingVertical: 10 }} accessibilityRole="button">
      <Text>{row.name}</Text>
      {row.unread ? <Text tone="muted">{row.unread} unread</Text> : null}
    </Pressable>
  );
}

function SpaceRow({ id }: { id: string }) {
  const space = useSpace(id);
  return <Text style={{ paddingVertical: 6 }}>{space?.name ?? id}</Text>;
}

function useEngineState() {
  const [state, setState] = useState(cryptoHost.state);
  useEffect(() => cryptoHost.onStateChange(setState), []);
  return state;
}

function Nav() {
  const theme = useTheme();
  const me = useMe();
  const pms = usePmRoomIds();
  const spaces = useSpaceIds();
  const engine = useEngineState();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.card }}>
      <FlatList
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <View style={{ gap: 6, marginBottom: 12 }}>
            <Text variant="heading">{me?.display_name || me?.username || '…'}</Text>
            <Text tone="muted">E2EE engine: {engine}</Text>
            <Text variant="label">{t('mobile.tabs.home', { defaultValue: 'Spaces' })}</Text>
            {spaces.map((id) => (
              <SpaceRow key={id} id={id} />
            ))}
            <Text variant="label">Private Messages</Text>
          </View>
        }
        data={pms}
        keyExtractor={(id) => id}
        renderItem={({ item }) => <PmRow id={item} />}
        ListFooterComponent={<Button title="Sign out" variant="secondary" onPress={() => void signOut()} />}
      />
    </SafeAreaView>
  );
}

function Content() {
  const theme = useTheme();
  const view = useSolid(() => shell.view());
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background, padding: 16 }}>
      <Text variant="heading">{view.kind === 'room' ? `Room ${view.roomId}` : 'Nothing open'}</Text>
    </SafeAreaView>
  );
}

export default function Shell() {
  return <SwipeShell nav={<Nav />} content={<Content />} />;
}
