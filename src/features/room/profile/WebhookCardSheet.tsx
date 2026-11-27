/**
 * The webhook / bridged-person card as a bottom sheet (the web's WebhookCard), for
 * presentWebhookCard. Never a person's profile: neither is an account.
 *
 * - Webhook: the name and avatar it was posted under, the WEBHOOK tag, the room it posts into,
 *   "it isn't an account", and - for a viewer with Manage Webhooks there - who created it.
 * - Bridged person: "Alice on Discord" with the platform tag, the bot that really posted it
 *   (its profile one tap away) and through which bridge, what the room is bridged with, "not a
 *   Strafe account", "Not the Strafe account @alice" when a member here shares the name, the
 *   profile on the platform when the bridge allows it (through the external-link prompt), and
 *   "Block from this bridge" for moderators. The external user id is never shown.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { spaces } from '@web/stores/spaces';
import { findLoadedWebhook, refreshRoomWebhooks } from '@web/stores/webhooks';
import { roomBridges } from '@web/stores/bridges';
import { requestOpenExternalLink } from '@web/stores/externalLink';
import { canManageWebhooksIn } from '@web/lib/roomPerms';
import { bridgePlatformIcon, bridgePlatformLabel } from '@web/lib/bridgePlatforms';
import { confirmBlockBridgedUser } from '@web/lib/bridgeModeration';
import { resolveSpaceUser } from '@web/lib/spaceProfile';
import { useSolid } from '@/bridge/solid';
import { bridgedNamesake, canBlockBridged } from '@/data';
import { useTheme } from '@/theme';
import { Avatar, Button, Icon, Sheet, Text, Touchable, WebhookTag, useExternalStore, withAlpha } from '@/ui';
import { dismissWebhookCard, webhookCardStore, type WebhookCardSubject } from '../webhookCard';
import { showUserProfile } from './present';

function useCardView(s: WebhookCardSubject | null) {
  return useSolid(() => {
    if (!s) return null;
    const spaceId = s.spaceId ?? undefined;
    const roomId = s.roomId ?? undefined;
    const roomName = spaceId && roomId ? (spaces.spaceRoomsBySpaceId[spaceId]?.find((r) => r.id === roomId)?.name ?? '') : '';
    const b = s.bridge;
    if (!b) {
      const canManage = canManageWebhooksIn(spaceId, roomId);
      const w = canManage ? findLoadedWebhook(s.webhookId) : undefined;
      const creator = w?.creator ? w.creator.display_name || w.creator.username : '';
      return { kind: 'webhook' as const, roomName, canManage, webhookName: w?.name ?? '', creator };
    }
    const summary = roomBridges(spaceId, roomId).find((x) => x.id === b.bridgeId);
    const bridgeName = b.bridgeName || summary?.name || '';
    const via = b.via
      ? { id: b.via.id, name: b.via.name || resolveSpaceUser(spaceId, b.via.id, undefined, '').name || summary?.driver_name || t('bridges.card.theBot') }
      : undefined;
    return {
      kind: 'bridge' as const,
      platform: bridgePlatformLabel(b.platform, b.platformName),
      icon: bridgePlatformIcon(b.platform),
      externalBot: b.externalBot === true,
      bridgeName,
      remote: summary?.remote?.name ?? '',
      via,
      namesake: bridgedNamesake(s.spaceId, s.name, b.lookalike),
      profileUrl: b.profileUrl,
      canBlock: !!s.puppetId && canBlockBridged(s.spaceId, s.roomId),
    };
  }, [s]);
}

export function WebhookCardSheetHost() {
  const theme = useTheme();
  const request = useExternalStore(webhookCardStore);
  // Keep showing the last subject while the sheet slides away.
  const last = useRef<(WebhookCardSubject & { id: number }) | null>(request);
  if (request) last.current = request;
  const s = last.current;
  const view = useCardView(s);
  const [blocked, setBlocked] = useState(false);
  const requestId = request?.id;

  useEffect(() => {
    if (!request) return;
    setBlocked(false);
    // The creator is only on the managers' list: load it when such a viewer opens the card.
    if (!request.bridge && request.roomId && canManageWebhooksIn(request.spaceId ?? undefined, request.roomId) && !findLoadedWebhook(request.webhookId)) {
      void refreshRoomWebhooks(request.roomId).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  if (!s || !view) return <Sheet open={false} onClose={() => undefined} />;
  const ctx = { roomId: s.roomId ?? null, spaceId: s.spaceId ?? null };
  const openPerson = (id: string) => {
    dismissWebhookCard();
    showUserProfile(id, ctx);
  };

  async function block() {
    if (!s?.bridge || !s.puppetId) return;
    const done = await confirmBlockBridgedUser({
      bridgeId: s.bridge.bridgeId,
      puppetId: s.puppetId,
      name: s.name,
      platform: s.bridge.platform,
      ...(s.bridge.platformName ? { platformName: s.bridge.platformName } : {}),
    });
    if (done) setBlocked(true);
  }

  const muted = theme.colors.mutedForeground;
  const divider = { borderTopWidth: 1, borderTopColor: withAlpha(theme.colors.border, 0.6), paddingTop: 12 };

  return (
    <Sheet
      open={!!request}
      onClose={() => {
        if (webhookCardStore.get()) dismissWebhookCard();
      }}
      testID={view.kind === 'bridge' ? 'bridged-card' : 'webhook-card'}
    >
      <View style={{ gap: 12, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar uri={s.avatar ?? null} name={s.name} user={s.puppetId ?? s.webhookId} size="xl" />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
              <Text variant="title" weight="semibold" numberOfLines={1} color={s.colour} style={{ flexShrink: 1 }}>
                {s.name}
              </Text>
              <WebhookTag webhook={s.bridge ? { kind: 'bridge', bridge: s.bridge } : true} size="sm" />
            </View>
            {view.kind === 'bridge' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name={view.icon} size={11} tone="muted" />
                <Text variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {view.externalBot ? t('bridges.card.botOn', { platform: view.platform }) : t('bridges.card.userOn', { platform: view.platform })}
                </Text>
              </View>
            ) : view.roomName ? (
              <Text variant="caption" numberOfLines={1}>
                {t('webhooks.card.inRoom', { room: view.roomName })}
              </Text>
            ) : null}
          </View>
        </View>

        {view.kind === 'webhook' ? (
          <View style={[divider, { gap: 8 }]}>
            <Text variant="caption">{t('webhooks.card.notAnAccount')}</Text>
            {view.canManage && view.webhookName ? (
              <View style={{ gap: 2 }}>
                <Text variant="overline">{t('webhooks.card.webhookLabel')}</Text>
                <Text variant="body">
                  {view.webhookName}
                  {view.creator ? <Text variant="body" color={muted}>{` · ${t('webhooks.card.createdBy', { name: view.creator })}`}</Text> : null}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={[divider, { gap: 10 }]}>
            <Text variant="body">{t('bridges.card.headline', { name: s.name, platform: view.platform })}</Text>
            <View style={{ gap: 4 }}>
              <Text variant="overline">{t('bridges.card.bridgedBy')}</Text>
              {view.via ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                  <Touchable
                    feedback="opacity"
                    onPress={() => openPerson(view.via!.id)}
                    accessibilityRole="button"
                    accessibilityLabel={view.via.name}
                    accessibilityHint={t('mobile.chat.openProfile')}
                    hitSlop={8}
                    testID="bridged-card-via"
                  >
                    <Text variant="body" weight="semibold" tone="primary" numberOfLines={1}>
                      {view.via.name}
                    </Text>
                  </Touchable>
                  {view.bridgeName ? (
                    <Text variant="body" color={muted} numberOfLines={1} style={{ flexShrink: 1 }}>
                      {`· ${t('bridges.card.throughBridge', { name: view.bridgeName })}`}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <Text variant="body">{view.bridgeName || t('bridges.card.unknownBridge')}</Text>
              )}
              {view.remote ? <Text variant="caption">{t('bridges.card.remote', { remote: view.remote })}</Text> : null}
            </View>
            <Text variant="caption">{t('bridges.card.notAnAccount')}</Text>
            {view.namesake ? (
              <View
                testID="bridged-card-namesake"
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 6,
                  borderRadius: theme.radii.md,
                  borderWidth: 1,
                  borderColor: withAlpha(theme.colors.warning, 0.4),
                  backgroundColor: withAlpha(theme.colors.warning, 0.1),
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                }}
              >
                <Icon name="circle-info" size={12} color={theme.colors.warning} />
                <Text variant="caption" tone="default">
                  {t('bridges.card.notTheMember')}
                </Text>
                <Touchable
                  feedback="opacity"
                  onPress={() => openPerson(view.namesake!.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`@${view.namesake.username}`}
                  hitSlop={8}
                >
                  <Text variant="caption" weight="semibold" tone="primary">{`@${view.namesake.username}`}</Text>
                </Touchable>
              </View>
            ) : null}
            {view.profileUrl ? (
              <Button
                title={t('bridges.card.openProfile', { platform: view.platform })}
                variant="link"
                size="sm"
                icon="arrow-up-right-from-square"
                style={{ alignSelf: 'flex-start' }}
                onPress={() => {
                  const url = view.profileUrl!;
                  dismissWebhookCard();
                  requestOpenExternalLink(url);
                }}
              />
            ) : null}
            {view.canBlock ? (
              <View style={divider}>
                {blocked ? (
                  <View accessibilityRole="text" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name="check" size={12} color={theme.colors.success} />
                    <Text variant="caption">{t('bridges.block.done', { name: s.name })}</Text>
                  </View>
                ) : (
                  <Button title={t('bridges.block.fromBridge')} variant="outline" icon="user-slash" fullWidth onPress={() => void block()} testID="bridged-card-block" />
                )}
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Sheet>
  );
}
