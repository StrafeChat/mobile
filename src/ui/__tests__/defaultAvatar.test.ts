/// <reference types="jest" />
// federationIds reaches the web store graph (stores/instance -> the gateway client), which
// needs its jest stand-ins.
import '@/data/testing/webMocks';
/**
 * Which default avatar a person gets: the web's rule (lib/defaultAvatar), on the id their
 * home instance knows them by, with the bundled images in the contract's order.
 */
import { DEFAULT_AVATAR_COUNT, defaultAvatarIndex } from '@web/lib/defaultAvatar';
import { registerUserIdentity } from '@web/stores/federationIds';
import { avatarRef } from '../avatarRef';
import { DEFAULT_AVATAR_IMAGES, userDefaultAvatarIndex, userDefaultAvatarSource } from '../defaultAvatar';

// (id >> 22) % 8: 4194304 is 1 << 22, so k << 22 picks index k % 8.
const idFor = (index: number, low = 12345) => String((BigInt(index) << 22n) | BigInt(low));
const LOCAL = idFor(1); // this instance's shadow id for a remote person: index 1
const HOME = idFor(6); // their id at home: index 6

describe('the bundled default avatars', () => {
  it('are the web set, one image per index', () => {
    expect(DEFAULT_AVATAR_COUNT).toBe(8);
    expect(DEFAULT_AVATAR_IMAGES).toHaveLength(DEFAULT_AVATAR_COUNT);
    expect(new Set(DEFAULT_AVATAR_IMAGES.map((x) => JSON.stringify(x))).size).toBe(DEFAULT_AVATAR_COUNT);
    // In the contract's order: index i is web/public/avatars/default/<i>.png.
    DEFAULT_AVATAR_IMAGES.forEach((img, i) => expect(JSON.stringify(img)).toContain(`avatars/default/${i}.png`));
  });
});

describe('userDefaultAvatarIndex', () => {
  it('follows the web helper for a local person', () => {
    for (let i = 0; i < 8; i++) expect(userDefaultAvatarIndex(idFor(i))).toBe(i);
    expect(userDefaultAvatarIndex('1234567890123456789')).toBe(defaultAvatarIndex('1234567890123456789'));
    expect(userDefaultAvatarIndex({ id: idFor(3) })).toBe(3);
  });

  it('uses the home id when the payload carries it, in either shape', () => {
    expect(userDefaultAvatarIndex({ id: LOCAL, origin_id: HOME })).toBe(6);
    expect(userDefaultAvatarIndex({ userId: LOCAL, originId: HOME })).toBe(6);
    expect(userDefaultAvatarIndex({ userId: LOCAL })).toBe(1);
  });

  it('finds the home id in the federation registry when the payload has only the local id', () => {
    const local = idFor(2, 777);
    expect(userDefaultAvatarIndex(local)).toBe(2);
    registerUserIdentity({ id: local, home_domain: 'remote.example', origin_id: idFor(5) });
    expect(userDefaultAvatarIndex(local)).toBe(5);
    expect(userDefaultAvatarIndex({ id: local })).toBe(5);
    expect(userDefaultAvatarIndex({ userId: local })).toBe(5);
    // A payload's own origin_id still wins.
    expect(userDefaultAvatarIndex({ id: local, origin_id: idFor(7) })).toBe(7);
  });

  it('gives an unknown or invalid person index 0', () => {
    expect(userDefaultAvatarIndex(null)).toBe(0);
    expect(userDefaultAvatarIndex(undefined)).toBe(0);
    expect(userDefaultAvatarIndex('not-an-id')).toBe(0);
    expect(userDefaultAvatarIndex({ userId: null })).toBe(0);
  });

  it('maps to the image at that index', () => {
    expect(userDefaultAvatarSource({ id: LOCAL, origin_id: HOME })).toBe(DEFAULT_AVATAR_IMAGES[6]);
    expect(userDefaultAvatarSource(null)).toBe(DEFAULT_AVATAR_IMAGES[0]);
  });
});

describe('avatarRef', () => {
  it('turns any person shape into plain { userId, originId }', () => {
    expect(avatarRef({ id: LOCAL, origin_id: HOME, username: 'x' } as { id: string; origin_id: string })).toEqual({ userId: LOCAL, originId: HOME });
    expect(avatarRef({ userId: LOCAL, originId: HOME })).toEqual({ userId: LOCAL, originId: HOME });
    expect(avatarRef(LOCAL)).toEqual({ userId: LOCAL });
    expect(avatarRef(null)).toEqual({ userId: null });
  });
});
