/**
 * A bridged room as the person in it sees it (spec 5.9): the header badge and its panel (what
 * the room is bridged with, by whom, whether it runs, "Your messages: copied / not copied"),
 * the composer hint until they post or close it, and the space's "Bridge privacy" sheet (the
 * per-space choice goes to the server; the effective answer follows the account default and
 * the space's mode).
 */
import './roomTestSetup';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { setSpaces } from '@web/stores/spaces';
import { setAuth } from '@web/stores/auth';
import { bridges, clearBridges, setSpaceConsentLocal } from '@web/stores/bridges';
import { closeSpaceBridgeConsent, openSpaceBridgeConsent } from '@web/stores/bridgeConsentDialog';
import type { BridgeSummary } from '@web/api/bridges';
import { PermViewChannel } from '@web/lib/spacePermissions';
import { ME, resetStores, role, space, sroom } from '@/data/testing/fixtures';

jest.mock('@web/api/bridges', () => ({
  ...jest.requireActual<object>('@web/api/bridges'),
  getAccountBridgeConsent: jest.fn(async () => null),
  getMySpaceBridgeConsent: jest.fn(async () => ({ state: 'inherit' })),
  setMySpaceBridgeConsent: jest.fn(async () => undefined),
}));
const api = jest.requireMock('@web/api/bridges') as { setMySpaceBridgeConsent: jest.Mock };

const { BridgeComposerHint, BridgeHeaderBadge, SpaceBridgeConsentSheetHost, bridgeBadgeText, bridgeStateText } =
  require('../bridges/BridgeUi') as typeof import('../bridges/BridgeUi');
const { bridgeHintVisible, markBridgeHintSeen, resetBridgeHintsForTests } = require('../bridges/bridgeHint') as typeof import('../bridges/bridgeHint');

const DISCORD: BridgeSummary = {
  id: 'b1',
  platform: 'discord',
  name: 'Discord #general',
  remote: { name: 'Strafe Fans #general', url: null },
  state: 'active',
  driver_name: 'Strife',
};

function seed(list: BridgeSummary[]) {
  setSpaces({
    spaces: [space('s1', [role('ev', 0, PermViewChannel, { name: '@everyone' })], { name: 'Garden' })],
    spaceRoomsBySpaceId: { s1: [sroom('r1', 3, { name: 'general', bridges: list })] },
    loading: false,
    hydrated: true,
  });
}

beforeEach(() => {
  resetStores();
  clearBridges();
  resetBridgeHintsForTests();
  api.setMySpaceBridgeConsent.mockClear();
});

afterEach(async () => {
  await act(async () => closeSpaceBridgeConsent());
});

describe('badge text and state', () => {
  test('running bridges by platform, else "paused"; reasons in words', () => {
    expect(bridgeBadgeText([DISCORD, { ...DISCORD, id: 'b2', platform: 'matrix' }])).toBe('Bridged: Discord, Matrix');
    expect(bridgeBadgeText([{ ...DISCORD, state: 'paused' }])).toBe('Bridge paused: Discord');
    expect(bridgeStateText(DISCORD)).toBe('');
    expect(bridgeStateText({ state: 'paused', state_reason: 'driver_lost_permission' })).toMatch(/lost a permission/);
    expect(bridgeStateText({ state: 'disabled', state_reason: 'something new' })).toBe('Off');
  });
});

describe('header badge', () => {
  test('nothing for an unbridged room; the panel says what it is bridged with and what happens to yours', async () => {
    seed([]);
    const empty = await render(<BridgeHeaderBadge spaceId="s1" roomId="r1" />);
    expect(screen.queryByTestId('bridge-badge')).toBeNull();
    await act(async () => empty.unmount());

    seed([DISCORD]);
    await render(<BridgeHeaderBadge spaceId="s1" roomId="r1" />);
    expect(screen.getByLabelText('Bridged: Discord')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bridge-badge'));
    expect(screen.getByText('This room is bridged')).toBeTruthy();
    expect(screen.getByText('Strafe Fans #general')).toBeTruthy();
    expect(screen.getByText(/Run by Strife/)).toBeTruthy();
    expect(screen.getByText('Your messages: copied')).toBeTruthy();
  });

  test('your account default off: not copied', async () => {
    seed([DISCORD]);
    setAuth('user', { id: ME, username: 'me', bridge_consent: 'deny' } as never);
    await render(<BridgeHeaderBadge spaceId="s1" roomId="r1" />);
    await fireEvent.press(screen.getByTestId('bridge-badge'));
    expect(screen.getByText('Your messages: not copied')).toBeTruthy();
  });
});

describe('composer hint', () => {
  test('shows until closed, and again for a new bridge', async () => {
    seed([DISCORD]);
    await render(<BridgeComposerHint spaceId="s1" roomId="r1" />);
    expect(screen.getByText('This room is bridged to Discord. Your messages are copied there.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bridge-hint-dismiss'));
    expect(screen.queryByTestId('bridge-hint-allow')).toBeNull();
    expect(bridgeHintVisible('s1', 'r1')).toBe(false);
    await act(async () => seed([DISCORD, { ...DISCORD, id: 'b2', platform: 'matrix' }]));
    expect(bridgeHintVisible('s1', 'r1')).toBe(true);
    expect(screen.getByText('This room is bridged to Discord, Matrix. Your messages are copied there.')).toBeTruthy();
    // Posting there (the composer calls this) puts it away too.
    await act(async () => markBridgeHintSeen('s1', 'r1'));
    expect(bridgeHintVisible('s1', 'r1')).toBe(false);
    expect(screen.queryByTestId('bridge-hint-allow')).toBeNull();
  });

  test('a paused bridge copies nothing: no hint', () => {
    seed([{ ...DISCORD, state: 'paused' }]);
    expect(bridgeHintVisible('s1', 'r1')).toBe(false);
  });
});

describe('space bridge privacy', () => {
  test('choosing "Don\'t allow" goes to the server and turns copying off here', async () => {
    seed([DISCORD]);
    await render(<SpaceBridgeConsentSheetHost />);
    await act(async () => {
      openSpaceBridgeConsent('s1');
    });
    // The person's choice is read first; until then the choices wait.
    await act(async () => {
      setSpaceConsentLocal('s1', 'inherit');
    });
    expect(screen.getByText('Rooms in this space are bridged to Discord. Choose whether bridges here may copy your messages there.')).toBeTruthy();
    expect(screen.getByTestId('bridge-consent-effective-allow')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('bridge-consent-deny'));
    });
    expect(api.setMySpaceBridgeConsent).toHaveBeenCalledWith('s1', 'deny');
    expect(bridges.bySpace.s1?.state).toBe('deny');
    expect(screen.getByTestId('bridge-consent-effective-deny')).toBeTruthy();
  });
});
