/**
 * Space settings -> Moderation (SpaceModerationPage): the verification level a member without
 * a role must meet before talking, and the light automod rules (repeated messages, invite
 * links, mass mentions with a limit), and whether the space's bridges copy everyone who has not
 * opted out or only those who opted in (spec 5.9; Manage Space). Saves on change.
 *
 * The mention limit is a stepper (plus a numeric field) instead of the web's number input; it
 * commits on blur / done, ignoring invalid or unchanged values, as the web does.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import {
  AUTOMOD_DEFAULT_MENTION_LIMIT,
  AUTOMOD_INVITE_LINKS,
  AUTOMOD_MASS_MENTIONS,
  AUTOMOD_MAX_MENTION_LIMIT,
  AUTOMOD_REPEATED_MESSAGES,
  VERIFICATION_LEVELS,
  patchSpace,
  type PatchSpaceInput,
} from '@web/api/spaces';
import { addOrUpdateSpace } from '@web/stores/spaces';
import { setSpaceBridgeConsentMode } from '@web/api/bridges';
import { ensureSpaceBridgeConsent, setSpaceModeLocal } from '@web/stores/bridges';
import { translateCaughtApiError } from '@web/lib/formatApiError';
import { useBridgeConsent } from '@/data';
import { openBridgesLearnMore } from '@/features/room/bridges/learnMore';
import { Button, IconButton, Input, ListSection, Text } from '@/ui';
import { Note, SettingToggle, choiceRows } from '../components/rows';
import { SpacePage } from './SpacePage';
import type { SpaceSettingsData } from './useSpaceSettings';

const LEVEL_KEYS = ['none', 'low', 'medium', 'high'] as const;

/** A typed mention limit to save, or null when it is invalid or unchanged (the web's commitLimit). */
export function parseMentionLimit(raw: string, current: number): number | null {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > AUTOMOD_MAX_MENTION_LIMIT || n === current) return null;
  return n;
}

function Moderation({ data, setError }: { data: SpaceSettingsData; setError: (m: string) => void }) {
  const space = data.space!;
  const canManage = data.gates.canManageSpace;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const flags = space.automod_flags ?? 0;
  const limit = space.automod_mention_limit || AUTOMOD_DEFAULT_MENTION_LIMIT;
  const disabled = !canManage || busy;

  async function patch(body: PatchSpaceInput) {
    if (!canManage || busy) return;
    setBusy(true);
    setError('');
    try {
      addOrUpdateSpace(await patchSpace(data.spaceId, body));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  // The space object may not say its bridge mode; the member's own consent read does.
  useEffect(() => {
    void ensureSpaceBridgeConsent(data.spaceId);
  }, [data.spaceId]);
  const optIn = useBridgeConsent(data.spaceId).mode === 'optin';
  async function setOptIn(on: boolean) {
    if (!canManage || busy) return;
    setBusy(true);
    setError('');
    try {
      const mode = on ? 'optin' : 'optout';
      await setSpaceBridgeConsentMode(data.spaceId, mode);
      setSpaceModeLocal(data.spaceId, mode);
    } catch (e) {
      setError(translateCaughtApiError(e, t).join(' ') || t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const setFlag = (bit: number, on: boolean) => void patch({ automod_flags: on ? flags | bit : flags & ~bit });
  const commit = (raw: string) => {
    setDraft(null);
    const n = parseMentionLimit(raw, limit);
    if (n !== null) void patch({ automod_mention_limit: n });
  };

  return (
    <>
      <ListSection title={t('spaceSettings.moderation.verificationTitle')}>
        {choiceRows<number>({
          value: space.verification_level ?? 0,
          disabled,
          testIDPrefix: 'verification',
          onChange: (lvl) => void patch({ verification_level: lvl }),
          options: VERIFICATION_LEVELS.map((lvl) => ({
            value: lvl,
            title: t(`spaceSettings.moderation.levels.${LEVEL_KEYS[lvl]}.title`),
            description: t(`spaceSettings.moderation.levels.${LEVEL_KEYS[lvl]}.description`),
          })),
        })}
      </ListSection>
      <Note>{t('spaceSettings.moderation.verificationHint')}</Note>

      <ListSection title={t('spaceSettings.moderation.automodTitle')}>
        <SettingToggle
          icon="repeat"
          title={t('spaceSettings.moderation.repeated.title')}
          description={t('spaceSettings.moderation.repeated.description')}
          value={(flags & AUTOMOD_REPEATED_MESSAGES) !== 0}
          disabled={disabled}
          onValueChange={(on) => setFlag(AUTOMOD_REPEATED_MESSAGES, on)}
        />
        <SettingToggle
          icon="link-slash"
          title={t('spaceSettings.moderation.invites.title')}
          description={t('spaceSettings.moderation.invites.description')}
          value={(flags & AUTOMOD_INVITE_LINKS) !== 0}
          disabled={disabled}
          onValueChange={(on) => setFlag(AUTOMOD_INVITE_LINKS, on)}
        />
        <SettingToggle
          icon="at"
          title={t('spaceSettings.moderation.mentions.title')}
          description={t('spaceSettings.moderation.mentions.description')}
          value={(flags & AUTOMOD_MASS_MENTIONS) !== 0}
          disabled={disabled}
          onValueChange={(on) => setFlag(AUTOMOD_MASS_MENTIONS, on)}
          testID="automod-mentions"
        />
        {(flags & AUTOMOD_MASS_MENTIONS) !== 0 ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 6 }}>
            <Text variant="label">{t('spaceSettings.moderation.mentions.limit')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <IconButton
                icon="minus"
                label={t('mobile.settings.decrease')}
                disabled={disabled || limit <= 1}
                onPress={() => void patch({ automod_mention_limit: Math.max(1, limit - 1) })}
              />
              <Input
                value={draft ?? String(limit)}
                onChangeText={setDraft}
                onBlur={() => draft !== null && commit(draft)}
                onSubmitEditing={() => draft !== null && commit(draft)}
                keyboardType="number-pad"
                returnKeyType="done"
                maxLength={2}
                disabled={disabled}
                accessibilityLabel={t('spaceSettings.moderation.mentions.limit')}
                containerStyle={{ width: 80 }}
                inputStyle={{ textAlign: 'center' }}
                testID="automod-limit"
              />
              <IconButton
                icon="plus"
                label={t('mobile.settings.increase')}
                disabled={disabled || limit >= AUTOMOD_MAX_MENTION_LIMIT}
                onPress={() => void patch({ automod_mention_limit: Math.min(AUTOMOD_MAX_MENTION_LIMIT, limit + 1) })}
              />
            </View>
            <Text variant="caption">{t('spaceSettings.moderation.mentions.limitHint', { max: String(AUTOMOD_MAX_MENTION_LIMIT) })}</Text>
          </View>
        ) : null}
      </ListSection>
      <Note>{t('spaceSettings.moderation.automodHint')}</Note>

      <ListSection title={t('spaceSettings.moderation.bridges.title')}>
        <SettingToggle
          icon="bridge"
          title={t('spaceSettings.moderation.bridges.optIn')}
          description={optIn ? t('spaceSettings.moderation.bridges.optInOn') : t('spaceSettings.moderation.bridges.optInOff')}
          value={optIn}
          disabled={disabled}
          onValueChange={(on) => void setOptIn(on)}
          testID="bridge-optin"
        />
      </ListSection>
      <Note>{t('spaceSettings.moderation.bridges.hint')}</Note>
      <Button title={t('bridges.learnMore')} variant="link" size="sm" style={{ alignSelf: 'flex-start', marginHorizontal: 16 }} onPress={openBridgesLearnMore} />
    </>
  );
}

export function SpaceModerationScreen() {
  return <SpacePage page="moderation">{(data, { setError }) => <Moderation data={data} setError={setError} />}</SpacePage>;
}
