/**
 * A person picker sheet for the search screen's From / Mentions chips: the room's people
 * (a space's members, or a PM's participants plus anyone seen in its messages), filtered by
 * nickname, name or username as you type. A space's members show by their space profile, with
 * the username under a name that is not it.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { Avatar, BotTag, EmptyState, ListRow, SearchInput, Sheet, SheetFlashList } from '@/ui';
import type { FlashList } from '@shopify/flash-list';
import { filterPeople, personAvatar, personLabel, type PickablePerson } from './searchModel';

export { filterPeople, personAvatar, personLabel, type PickablePerson };

export interface PeoplePickerProps {
  open: boolean;
  title: string;
  people: readonly PickablePerson[];
  selectedId?: string;
  onPick: (person: PickablePerson) => void;
  onClose: () => void;
}

export function PeoplePicker({ open, title, people, selectedId, onPick, onClose }: PeoplePickerProps) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => filterPeople(people, query), [people, query]);
  const List = SheetFlashList as unknown as typeof FlashList;
  return (
    <Sheet
      open={open}
      onClose={() => {
        setQuery('');
        onClose();
      }}
      title={title}
      snapPoints={['70%', '92%']}
      padded={false}
      contentStyle={{ flex: 1 }}
    >
      <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
        <SearchInput value={query} onValueChange={setQuery} placeholder={t('mobile.room.findPeople')} />
      </View>
      <View style={{ flex: 1 }}>
        <List
          data={shown}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<EmptyState icon="user" body={t('mobile.room.noMembersMatch')} />}
          renderItem={({ item }) => (
            <ListRow
              title={personLabel(item)}
              subtitle={personLabel(item) !== item.username ? item.username : undefined}
              leading={<Avatar uri={personAvatar(item)} name={personLabel(item)} size="md" />}
              titleAccessory={<BotTag bot={item.bot} size="xs" style={{ marginStart: 6 }} />}
              selected={item.id === selectedId}
              onPress={() => {
                setQuery('');
                onPick(item);
              }}
            />
          )}
        />
      </View>
    </Sheet>
  );
}
