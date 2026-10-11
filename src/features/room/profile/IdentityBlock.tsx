/**
 * The identity block every profile surface shows (the web's ProfileIdentity): the display
 * name in the member's role colour with the BOT / OFFICIAL tags and the 🎂, the handle (with
 * the home instance for a remote account - always in the full profile), pronouns, "It's
 * their birthday!" and the badge row. One component for the sheet and the full profile so
 * the same person never looks different on the two.
 *
 * The handle is left-to-right in every locale (it is a fixed sequence) and copies on a long
 * press; in the sheet a tap on the name or the handle opens the full profile, in the full
 * profile a tap on the handle copies it.
 */
import { View } from 'react-native';
import { instance, isRemoteUser, formatHandle } from '@web/stores/instance';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { BotTag, Icon, OfficialTag, Text, Touchable, UserBadges } from '@/ui';
import { copyText } from '../util';

/** How many badges draw before the rest fold into `+N` (the web's PROFILE_BADGE_CAP). */
export const PROFILE_BADGE_CAP = 5;

export interface IdentityBlockProps {
  displayName: string;
  username: string;
  homeDomain?: string;
  bot?: boolean;
  system?: boolean;
  publicFlags?: number;
  pronouns?: string;
  isBirthday?: boolean;
  nameColor?: string;
  /** The sheet (compact) or the full profile. */
  compact?: boolean;
  /** Name this instance after a local account's username too (the full profile). */
  alwaysShowDomain?: boolean;
  /** The sheet: name and handle open the full profile. */
  onOpenProfile?: () => void;
}

export function IdentityBlock(props: IdentityBlockProps) {
  const domainHere = useSolid(() => instance.domain);
  const remote = isRemoteUser({ home_domain: props.homeDomain });
  const domain = remote ? (props.homeDomain ?? '') : props.alwaysShowDomain ? props.homeDomain || domainHere : '';
  const handle = formatHandle({ username: props.username, home_domain: props.homeDomain });
  const copyHandle = () => void copyText(handle);

  const name = (
    <Text variant={props.compact ? 'heading' : 'title'} color={props.nameColor} accessibilityRole="header" style={{ flexShrink: 1 }}>
      {props.displayName}
    </Text>
  );

  const tag = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0, flexShrink: 1 }}>
      <Text variant="label" tone="muted" numberOfLines={1} style={{ writingDirection: 'ltr', flexShrink: 1 }}>
        {props.username}
        {domain ? (
          <Text variant="label" tone={remote ? 'primary' : 'muted'}>
            @{domain}
          </Text>
        ) : null}
      </Text>
      {!props.onOpenProfile ? <Icon name="fa-regular fa-copy" size={11} tone="muted" /> : null}
    </View>
  );

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        {props.onOpenProfile ? (
          <Touchable onPress={props.onOpenProfile} accessibilityRole="button" accessibilityHint={t('profile.viewFull')} feedback="opacity">
            {name}
          </Touchable>
        ) : (
          name
        )}
        <BotTag bot={props.bot} size={props.compact ? 'sm' : 'md'} />
        <OfficialTag system={props.system} size={props.compact ? 'sm' : 'md'} />
        {props.isBirthday ? (
          <Text accessibilityLabel={t('profile.birthdayToday')} accessibilityRole="image">
            🎂
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 2 }}>
        <Touchable
          onPress={props.onOpenProfile ?? copyHandle}
          onLongPress={copyHandle}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel={handle}
          accessibilityHint={props.onOpenProfile ? t('profile.viewFull') : t('common.copy')}
          hitSlop={8}
          style={{ flexShrink: 1 }}
        >
          {tag}
        </Touchable>
        {props.pronouns?.trim() ? (
          <Text variant="caption" numberOfLines={1}>
            {props.pronouns.trim()}
          </Text>
        ) : null}
      </View>

      {props.isBirthday ? (
        <Text variant="caption" tone="primary" weight="medium">
          {t('profile.birthdayToday')}
        </Text>
      ) : null}

      {(props.publicFlags ?? 0) !== 0 ? <UserBadges flags={props.publicFlags} size={props.compact ? 14 : 16} max={PROFILE_BADGE_CAP} /> : null}
    </View>
  );
}
