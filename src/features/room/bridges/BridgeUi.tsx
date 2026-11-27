/**
 * A bridged room, as the person in it sees it (spec 5.9; the web's RoomBridgeBadge,
 * RoomBridgeHint and SpaceBridgeConsentDialog). A room is never bridged silently:
 *
 * - BridgeHeaderBadge: the "Bridged: Discord" chip in the room header (the glyph alone on a
 *   phone, the words on a tablet). Tap: what the room is bridged with (as each bridge declares
 *   it), the bot that runs it, whether it is running and why not, what that means for privacy,
 *   whether the viewer's own messages are copied, and a way to change that for the space.
 * - BridgeComposerHint: the one-line hint over the composer until the person has posted there
 *   once (or closed it): "...Your messages are copied there" / "...are not copied (your privacy
 *   setting)".
 * - SpaceBridgeConsentSheetHost: the space's "Bridge privacy" choice (use my default / allow /
 *   don't allow), opened through the web's stores/bridgeConsentDialog from the badge, the hint,
 *   the space menu and Privacy settings. Mounted once by RoomHosts.
 *
 * The server decides for real (it filters every bridge's feed); this only tells the person
 * what will happen and lets them change it.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import type { BridgeSummary, SpaceBridgeConsent } from '@web/api/bridges';
import { setMySpaceBridgeConsent } from '@web/api/bridges';
import { ensureAccountBridgeConsent, ensureSpaceBridgeConsent, setSpaceConsentLocal } from '@web/stores/bridges';
import { closeSpaceBridgeConsent, openSpaceBridgeConsent, spaceBridgeConsentFor } from '@web/stores/bridgeConsentDialog';
import { requestOpenExternalLink } from '@web/stores/externalLink';
import { spaces } from '@web/stores/spaces';
import { translateCaughtApiError } from '@web/lib/formatApiError';
import { bridgePlatformIcon, bridgePlatformLabel } from '@web/lib/bridgePlatforms';
import { useSolid } from '@/bridge/solid';
import { bridgedPlatformsLabel, useBridgeConsent, useRoomBridges } from '@/data';
import { useTheme } from '@/theme';
import { Button, Icon, Sheet, Text, Touchable, withAlpha } from '@/ui';
import { choiceRows } from '@/features/settings/components/rows';
import { openSettings } from '@/features/settings/navigation';
import { bridgeHintVisible, markBridgeHintSeen } from './bridgeHint';
import { openBridgesLearnMore } from './learnMore';

export { bridgesLearnMoreUrl, openBridgesLearnMore } from './learnMore';

/** Why a bridge is not running, for people (the web panel's stateText); '' when it runs. */
export function bridgeStateText(b: Pick<BridgeSummary, 'state' | 'state_reason'>): string {
  if (b.state === 'active') return '';
  const reason = b.state_reason ?? '';
  const known = ['paused_by_manager', 'became_private', 'driver_lost_permission', 'encrypted'];
  return known.includes(reason) ? t(`bridges.state.reason.${reason}`) : t(`bridges.state.${b.state === 'disabled' ? 'disabled' : 'paused'}`);
}

/** The badge's words: the running bridges' platforms, or "Bridge paused: ..." when none runs. */
export function bridgeBadgeText(list: readonly BridgeSummary[]): string {
  const active = list.filter((b) => b.state === 'active');
  const label = bridgedPlatformsLabel(active.length ? active : list);
  return active.length ? t('bridges.badge', { platforms: label }) : t('bridges.badgePaused', { platforms: label });
}

/** Load the viewer's consent once the room is bridged (what their own messages do). */
function useEnsureConsent(spaceId: string | null | undefined, when: boolean): void {
  useEffect(() => {
    if (!when || !spaceId) return;
    void ensureAccountBridgeConsent();
    void ensureSpaceBridgeConsent(spaceId);
  }, [when, spaceId]);
}

// ---- header badge ------------------------------------------------------------------------------------

export function BridgeHeaderBadge({ spaceId, roomId, wide }: { spaceId: string | null | undefined; roomId: string; wide?: boolean }) {
  const theme = useTheme();
  const list = useRoomBridges(spaceId, roomId);
  const [open, setOpen] = useState(false);
  useEnsureConsent(spaceId, list.length > 0);
  if (list.length === 0) return null;
  const active = list.some((b) => b.state === 'active');
  const text = bridgeBadgeText(list);
  const tint = active ? theme.colors.primary : theme.colors.mutedForeground;
  return (
    <>
      <Touchable
        feedback="opacity"
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityHint={t('bridges.panel.title')}
        hitSlop={10}
        testID="bridge-badge"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          height: 20,
          minWidth: 20,
          paddingHorizontal: wide ? 6 : 0,
          justifyContent: 'center',
          borderRadius: 6,
          backgroundColor: withAlpha(tint, 0.15),
        }}
      >
        <Icon name="bridge" size={10} color={tint} />
        {wide ? (
          <Text variant="caption" weight="medium" color={tint} numberOfLines={1} style={{ maxWidth: 180 }}>
            {text}
          </Text>
        ) : null}
      </Touchable>
      <BridgeInfoSheet open={open} onClose={() => setOpen(false)} spaceId={spaceId} roomId={roomId} />
    </>
  );
}

function BridgeInfoSheet({ open, onClose, spaceId, roomId }: { open: boolean; onClose: () => void; spaceId: string | null | undefined; roomId: string }) {
  const theme = useTheme();
  const list = useRoomBridges(spaceId, roomId);
  const consent = useBridgeConsent(spaceId);
  const active = list.filter((b) => b.state === 'active');
  const platforms = bridgedPlatformsLabel(active.length ? active : list);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) setShown(true);
  }, [open]);
  // The bridge went away while open: close.
  useEffect(() => {
    if (list.length === 0 && shown) setShown(false);
  }, [list.length, shown]);

  return (
    <Sheet open={open && shown} onClose={onClose} title={t('bridges.panel.title')} icon="fa-solid fa-bridge" scrollable testID="bridge-panel">
      <View style={{ gap: 12, paddingTop: 4 }}>
        {list.map((b) => {
          const state = bridgeStateText(b);
          return (
            <View
              key={b.id}
              testID={`bridge-summary-${b.id}`}
              style={{ gap: 4, padding: 12, borderRadius: theme.radii.lg, borderWidth: 1, borderColor: withAlpha(theme.colors.border, 0.7), backgroundColor: withAlpha(theme.colors.card, 0.5) }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name={bridgePlatformIcon(b.platform)} size={14} tone="muted" />
                <Text variant="label" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
                  {bridgePlatformLabel(b.platform, b.platform_name)}
                </Text>
                {b.state !== 'active' ? (
                  <Text variant="caption" weight="medium">
                    {b.state === 'disabled' ? t('bridges.state.disabled') : t('bridges.state.paused')}
                  </Text>
                ) : null}
              </View>
              {b.remote?.name ? (
                <View>
                  <Text variant="caption">
                    {`${t('bridges.panel.remote')} `}
                    {b.remote.url ? (
                      <Text
                        variant="caption"
                        weight="medium"
                        tone="primary"
                        onPress={() => {
                          const url = b.remote!.url!;
                          onClose();
                          requestOpenExternalLink(url);
                        }}
                        accessibilityRole="link"
                      >
                        {b.remote.name}
                      </Text>
                    ) : (
                      <Text variant="caption" weight="medium" tone="default">
                        {b.remote.name}
                      </Text>
                    )}
                  </Text>
                  <Text variant="caption" style={{ fontSize: theme.font(11) }}>
                    {t('bridges.panel.selfDeclared')}
                  </Text>
                </View>
              ) : null}
              <Text variant="caption">
                {b.driver_name ? t('bridges.panel.runBy', { bot: b.driver_name }) : t('bridges.panel.runByBot')}
                {b.name ? ` · ${b.name}` : ''}
              </Text>
              {state ? (
                <Text variant="caption" color={theme.colors.warning}>
                  {state}
                </Text>
              ) : null}
            </View>
          );
        })}

        <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: withAlpha(theme.colors.border, 0.6), paddingTop: 12 }}>
          <Text variant="overline">{t('bridges.panel.privacyTitle')}</Text>
          <Text variant="caption">
            {`${t('bridges.panel.privacyBody', { platforms })} ${consent.mode === 'optin' ? t('bridges.panel.modeOptIn') : t('bridges.panel.modeOptOut')}`}
          </Text>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: theme.radii.md, backgroundColor: withAlpha(theme.colors.muted, 0.4) }}
            testID={`bridge-consent-${consent.effective}`}
          >
            <Icon name={consent.effective === 'allow' ? 'share-from-square' : 'eye-slash'} size={12} color={consent.effective === 'allow' ? theme.colors.primary : theme.colors.mutedForeground} />
            <Text variant="caption" tone="default" style={{ flex: 1 }}>
              {consent.effective === 'allow' ? t('bridges.panel.yoursCopied') : t('bridges.panel.yoursNotCopied')}
            </Text>
            {spaceId ? (
              <Button
                title={t('bridges.panel.change')}
                variant="link"
                size="sm"
                onPress={() => {
                  onClose();
                  openSpaceBridgeConsent(spaceId);
                }}
              />
            ) : null}
          </View>
          <Button title={t('bridges.learnMore')} variant="link" size="sm" style={{ alignSelf: 'flex-start' }} onPress={openBridgesLearnMore} />
        </View>
      </View>
    </Sheet>
  );
}

// ---- composer hint ---------------------------------------------------------------------------------------

export function BridgeComposerHint({ spaceId, roomId }: { spaceId: string | null | undefined; roomId: string }) {
  const theme = useTheme();
  const visible = useSolid(() => bridgeHintVisible(spaceId, roomId), [spaceId, roomId]);
  const list = useRoomBridges(spaceId, roomId);
  const consent = useBridgeConsent(spaceId);
  useEnsureConsent(spaceId, visible);
  if (!visible) return null;
  const platforms = bridgedPlatformsLabel(list.filter((b) => b.state === 'active'));
  return (
    <View
      accessibilityRole="text"
      testID={`bridge-hint-${consent.effective}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6 }}
    >
      <Icon name="bridge" size={11} tone="primary" />
      <Text variant="caption" style={{ flex: 1 }}>
        {consent.effective === 'allow' ? t('bridges.hint.copied', { platforms }) : t('bridges.hint.notCopied', { platforms })}
      </Text>
      {spaceId ? <Button title={t('bridges.hint.change')} variant="link" size="sm" onPress={() => openSpaceBridgeConsent(spaceId)} /> : null}
      <Touchable
        feedback="opacity"
        onPress={() => markBridgeHintSeen(spaceId, roomId)}
        accessibilityRole="button"
        accessibilityLabel={t('bridges.hint.dismiss')}
        hitSlop={12}
        testID="bridge-hint-dismiss"
        style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radii.sm }}
      >
        <Icon name="xmark" size={12} tone="muted" />
      </Touchable>
    </View>
  );
}

// ---- space consent -----------------------------------------------------------------------------------

const CHOICES: SpaceBridgeConsent[] = ['inherit', 'allow', 'deny'];

export function SpaceBridgeConsentSheetHost() {
  const spaceId = useSolid(() => spaceBridgeConsentFor());
  const [last, setLast] = useState<string | null>(spaceId);
  useEffect(() => {
    if (spaceId) setLast(spaceId);
  }, [spaceId]);
  const shown = spaceId ?? last;
  return <SpaceBridgeConsentSheet spaceId={shown} open={!!spaceId} />;
}

function SpaceBridgeConsentSheet({ spaceId, open }: { spaceId: string | null; open: boolean }) {
  const consent = useBridgeConsent(spaceId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const view = useSolid(() => {
    if (!spaceId) return { name: '', platforms: '' };
    const sp = spaces.spaces.find((s) => s.id === spaceId);
    const rooms = spaces.spaceRoomsBySpaceId[spaceId] ?? [];
    return { name: sp?.name ?? '', platforms: bridgedPlatformsLabel(rooms.flatMap((r) => r.bridges ?? [])) };
  }, [spaceId]);

  useEffect(() => {
    if (!open || !spaceId) return;
    setError('');
    void ensureAccountBridgeConsent();
    void ensureSpaceBridgeConsent(spaceId);
  }, [open, spaceId]);

  async function choose(state: SpaceBridgeConsent) {
    if (!spaceId || busy || state === consent.spaceState) return;
    setBusy(true);
    setError('');
    try {
      await setMySpaceBridgeConsent(spaceId, state);
      setSpaceConsentLocal(spaceId, state);
    } catch (e) {
      setError(translateCaughtApiError(e, t).join(' '));
    } finally {
      setBusy(false);
    }
  }

  const inheritText =
    consent.account === 'deny' ? t('bridges.consent.inheritDeny') : consent.mode === 'optin' ? t('bridges.consent.inheritOptIn') : t('bridges.consent.inheritOptOut');

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (spaceBridgeConsentFor()) closeSpaceBridgeConsent();
      }}
      title={t('bridges.consent.spaceTitle')}
      description={view.name}
      icon="fa-solid fa-bridge"
      dismissible={!busy}
      scrollable
      testID="space-bridge-consent"
    >
      <View style={{ gap: 12, paddingTop: 4 }}>
        <Text variant="caption">
          {view.platforms ? t('bridges.consent.spaceIntroBridged', { platforms: view.platforms }) : t('bridges.consent.spaceIntro')}
        </Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('bridges.consent.spaceTitle')}>
          {choiceRows<SpaceBridgeConsent>({
            value: consent.spaceLoaded ? consent.spaceState : null,
            disabled: busy || !consent.spaceLoaded,
            testIDPrefix: 'bridge-consent',
            onChange: (c) => void choose(c),
            options: CHOICES.map((c) => ({
              value: c,
              title: t(`bridges.consent.choice.${c}`),
              description: c === 'inherit' ? inheritText : t(`bridges.consent.choiceHelp.${c}`),
            })),
          })}
        </View>
        <Text variant="caption" tone="default" testID={`bridge-consent-effective-${consent.effective}`}>
          {consent.effective === 'allow' ? t('bridges.consent.effectiveAllow') : t('bridges.consent.effectiveDeny')}
        </Text>
        <Text variant="caption">{t('bridges.consent.denyNote')}</Text>
        {error ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
          <Button
            title={t('bridges.consent.accountDefault')}
            variant="ghost"
            size="sm"
            onPress={() => {
              closeSpaceBridgeConsent();
              openSettings('privacy');
            }}
          />
          <Button title={t('bridges.learnMore')} variant="link" size="sm" onPress={openBridgesLearnMore} />
        </View>
      </View>
    </Sheet>
  );
}
