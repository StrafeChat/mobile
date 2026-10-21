/**
 * The search screen's From / Mentions pickers in a space: people are found by nickname too and
 * shown by their space profile, with the global profile when they have none.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { describe, expect, test } from '@jest/globals';
import { filterPeople, personAvatar, personLabel, type PickablePerson } from '../search/searchModel';

const people: PickablePerson[] = [
  { id: '1', username: 'alice', display_name: 'Alice Liddell', avatar: 'a.png', nick: 'Rabbit', space_avatar: 'space-a.png' },
  { id: '2', username: 'bob', avatar: 'b.png', nick: '  ' },
];

describe('people pickers', () => {
  test('label and face: the space profile, else the global one', () => {
    expect(personLabel(people[0]!)).toBe('Rabbit');
    expect(personAvatar(people[0]!)).toBe('space-a.png');
    expect(personLabel(people[1]!)).toBe('bob');
    expect(personAvatar(people[1]!)).toBe('b.png');
  });

  test('the query matches the nickname as well as the name and username', () => {
    expect(filterPeople(people, 'rabb').map((p) => p.id)).toEqual(['1']);
    expect(filterPeople(people, 'liddell').map((p) => p.id)).toEqual(['1']);
    expect(filterPeople(people, '@BOB').map((p) => p.id)).toEqual(['2']);
  });
});
