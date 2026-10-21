/**
 * The profile sheet - the web's UserProfilePopover, as Discord mobile shows it: a bottom
 * sheet with the banner, the avatar (tap: full profile), the identity block, About Me, the
 * birthday, the member's roles in the space (editable with Manage Roles, under the same
 * hierarchy rules as the server), when they joined, and a one-line "Message @name" composer.
 * Opened in a space it shows the space profile (the nickname, with the global name under it)
 * and offers "Edit Space Profile" on your own, and "Change Nickname" wherever you may.
 *
 * It renders src/platform/presenters' profileSheet store, which the web's own open functions
 * reach too (overridden), so every surface that shows a person lands here.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { createPM } from '@web/api/rooms';
import { setMemberSpaceRoles } from '@web/api/spaces';
import { authorizeUrl, getPublicApplication } from '@web/api/developers';
import { openAppWindow } from '@web/lib/openWindow';
import { sendMessage } from '@web/stores/messages';
import { addOrUpdateRoom } from '@web/stores/rooms';
import { openUserProfileFullModal, type UserProfileFullSubject } from '@web/stores/userProfileFullModal';
import type { SpaceMemberRoleEditContext, UserProfilePopoverSubject } from '@web/stores/userProfilePopover';
import { memberNameColorHex, rolesForMemberProfile } from '@web/lib/userProfilePopoverHelpers';
import { spaceRoleColorHex } from '@web/lib/spacePermissions';
import { formatBirthday } from '@web/lib/utils/birthday';
import { spaces, spaceRoles } from '@web/stores/spaces';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { memberCanEditNickname, mySpaceMember, spaceMemberOf } from '@/data';
import { openSpaceProfile } from '@/features/settings';
import { dismissProfileSheet, profileSheet } from '@/platform/presenters';
import { setProfileSheet } from '@/platform/presenters/profileSheet';
import { useTheme } from '@/theme';
import {
  Button,
  Divider,
  IconButton,
  Input,
  RolePill,
  Sheet,
  Text,
  Touchable,
  showActionSheet,
  withAlpha,
  type ActionSheetEntry,
} from '@/ui';
import { buildUserMenuItems } from '@web/lib/userContextMenu';
import { MessageBody } from '@/features/chat';
import { copyText, errorMessage } from '../util';
import { openSafetyScreen } from '../navigation';
import { presentNicknameSheet } from '../nicknameSheet';
import { IdentityBlock } from './IdentityBlock';
import { ProfileArt } from './ProfileArt';
import {
  canEditMemberRoles,
  displayedRoles,
  mergedRoleIds,
  pickedFromContext,
  roleRemovable,
  rolesAvailableToAdd,
} from './roles';

const MAX_ROLE_CHIPS = 3;

/** The full profile's hand-over with the space-profile fields the bumped web adds. */
export type FullProfileSubject = UserProfileFullSubject & { globalName?: string; spaceId?: string };

export function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="overline" style={{ marginBottom: 6 }}>
      {children}
    </Text>
  );
}

/** "Birthday" + month and day, only for someone who opted in. */
export function BirthdayFact({ birthday }: { birthday?: string }) {
  const label = formatBirthday(birthday);
  if (!label) return null;
  return (
    <View>
      <SectionLabel>{t('profile.birthday')}</SectionLabel>
      <Text>{label}</Text>
    </View>
  );
}

/** A bot's "Add to Space", shown once its application resolves as public with a bot. */
function useBotInstallable(userId: string | undefined, bot: boolean | undefined): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setOk(false);
    if (!userId || !bot) return;
    let live = true;
    getPublicApplication(userId)
      .then((app) => {
        if (live) setOk(!!app?.has_bot && !!app?.bot_public);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [userId, bot]);
  return ok;
}

function RolesSection({
  subject,
  ctx,
  viewerId,
}: {
  subject: UserProfilePopoverSubject;
  ctx: SpaceMemberRoleEditContext | null;
  viewerId: string | undefined;
}) {
  const theme = useTheme();
  const editable = canEditMemberRoles(ctx, subject.userId, viewerId);
  const [picked, setPicked] = useState<Set<string>>(() => pickedFromContext(ctx));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const ctxKey = ctx ? `${ctx.spaceId}:${subject.userId}:${ctx.subjectRoleIds.join(',')}` : '';
  useEffect(() => {
    setPicked(pickedFromContext(ctx));
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);

  if (!ctx) {
    if (!subject.spaceRoles?.length) return null;
    return (
      <View>
        <SectionLabel>{t('profile.roles')}</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {subject.spaceRoles.map((r) => (
            <RolePill key={r.id} role={r} />
          ))}
        </View>
      </View>
    );
  }

  const roles = displayedRoles(ctx, picked, editable);
  const visible = expanded ? roles : roles.slice(0, MAX_ROLE_CHIPS);
  const hidden = roles.length - visible.length;

  async function persist(next: Set<string>) {
    if (!ctx || !editable) return;
    setError('');
    setBusy(true);
    try {
      const chosen = [...next];
      await setMemberSpaceRoles(ctx.spaceId, subject.userId, chosen);
      const merged = mergedRoleIds(ctx, chosen);
      setProfileSheet('spaceRoleContext', { ...ctx, subjectRoleIds: merged, spaceRoles: ctx.spaceRoles.map((r) => ({ ...r })) });
      if (profileSheet.subject) {
        setProfileSheet('subject', {
          ...profileSheet.subject,
          spaceRoles: rolesForMemberProfile(merged, ctx.spaceRoles),
          nameColor: memberNameColorHex(merged, ctx.spaceRoles),
        });
      }
      ctx.onMemberRolesUpdated?.();
    } catch (e) {
      setError(errorMessage(e, 'profile.rolesUpdateFailed'));
      setPicked(pickedFromContext(ctx));
    } finally {
      setBusy(false);
    }
  }

  function remove(roleId: string) {
    if (busy) return;
    const next = new Set(picked);
    next.delete(roleId);
    setPicked(next);
    void persist(next);
  }

  function add() {
    const available = rolesAvailableToAdd(ctx, picked, editable);
    const entries: ActionSheetEntry[] = available.length
      ? available.map((r) => ({
          key: r.id,
          label: r.name,
          leading: (
            <View
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: spaceRoleColorHex(r.color),
                borderWidth: 1,
                borderColor: withAlpha(theme.colors.border, 0.6),
              }}
            />
          ),
          onSelect: () => {
            const next = new Set(picked);
            next.add(r.id);
            setPicked(next);
            void persist(next);
          },
        }))
      : [{ label: t('profile.noRolesToAdd'), disabled: true }];
    void showActionSheet(entries, { title: t('profile.addRole') });
  }

  return (
    <View>
      <SectionLabel>{t('profile.roles')}</SectionLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {visible.map((r) => (
          <RolePill
            key={r.id}
            role={{ id: r.id, name: r.name, color: r.color ?? 0 }}
            onRemove={roleRemovable(r, ctx, editable) ? () => remove(r.id) : undefined}
            removeLabel={t('profile.removeRole', { name: r.name })}
            disabled={busy}
          />
        ))}
        {hidden > 0 ? (
          <Touchable
            onPress={() => setExpanded(true)}
            accessibilityRole="button"
            accessibilityLabel={t('profile.moreRoles', { count: hidden })}
            hitSlop={8}
            style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border }}
          >
            <Text variant="caption" weight="medium">{`+${hidden}`}</Text>
          </Touchable>
        ) : null}
        {editable ? (
          <IconButton icon="plus" label={t('profile.addRole')} onPress={add} disabled={busy} size="sm" tone="subtle" />
        ) : null}
      </View>
      {roles.length === 0 ? (
        <Text variant="caption" style={{ marginTop: 4 }}>
          {editable ? t('profile.noRolesYetEditable') : t('profile.noRolesAssigned')}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: 4 }} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Whether the viewer may change `userId`'s nickname in `spaceId` (their own with Change
 * Nickname, someone ranked below them with Manage Nicknames, never the owner's unless they are
 * the owner). Computed here from the stores, and it stays so after the web bump (only
 * memberCanEditNickname becomes a re-export): the web's spaceRoleContext.canEditNickname is
 * filled in by the web UI that builds the context, and mobile's builders (chat/people.ts
 * roleContext, profile/present.ts spaceRoleContextFor) never set it, the voice row and voice
 * sheet open the sheet with no context, and the context is null while the space's roles load.
 * Needs the person's member row: someone who has left has no nickname to change.
 */
function useCanEditNickname(spaceId: string | undefined, userId: string | undefined): boolean {
  return useSolid(() => {
    if (!spaceId || !userId) return false;
    const target = spaceMemberOf(spaceId, userId);
    if (!target) return false;
    return memberCanEditNickname(spaces.spaces.find((s) => s.id === spaceId), spaceRoles(spaceId), mySpaceMember(spaceId), target);
  }, [spaceId, userId]);
}

function QuickMessage({ subject, onDone }: { subject: UserProfilePopoverSubject; onDone: () => void }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      const room = await createPM(subject.userId);
      addOrUpdateRoom(room);
      await sendMessage(room.id, text);
      setDraft('');
      onDone();
    } catch (e) {
      setError(errorMessage(e, 'room.sendFailed'));
    } finally {
      setSending(false);
    }
  }
  return (
    <View style={{ gap: 4 }}>
      <Input
        value={draft}
        onChangeText={setDraft}
        placeholder={t('room.messageUser', { name: subject.displayName })}
        disabled={sending}
        returnKeyType="send"
        onSubmitEditing={() => void send()}
        error={error || undefined}
        right={
          <IconButton
            icon="paper-plane"
            label={t('common.send')}
            onPress={() => void send()}
            disabled={!draft.trim() || sending}
            tone="primary"
            size="sm"
          />
        }
      />
    </View>
  );
}

export function ProfileSheetHost() {
  const theme = useTheme();
  const open = useSolid(() => profileSheet.open);
  const live = useSolid(() => ({
    subject: profileSheet.subject,
    viewerId: profileSheet.currentUserId,
    onMessageUser: profileSheet.onMessageUser,
    ctx: profileSheet.spaceRoleContext,
  }));
  // Keep showing the last person while the sheet slides away.
  const last = useRef(live);
  if (live.subject) last.current = live;
  const { subject, viewerId, onMessageUser, ctx } = last.current;
  const botInstallable = useBotInstallable(subject?.userId, subject?.bot);
  const spaceId = subject?.spaceId;
  const canEditNickname = useCanEditNickname(spaceId, subject?.userId);

  if (!subject) return <Sheet open={false} onClose={() => undefined} />;
  const isSelf = subject.userId === viewerId;
  const close = () => dismissProfileSheet();

  const openFull = () => {
    // The bumped web's two extra fields ride along (the pinned type has neither yet): the global
    // name shown under a nickname, and the space, so the full profile shows the same space
    // profile. Typed as a variable rather than a literal so the pinned type still accepts it.
    const full: FullProfileSubject = {
      userId: subject.userId,
      displayName: subject.displayName,
      ...(subject.globalName ? { globalName: subject.globalName } : {}),
      ...(spaceId ? { spaceId } : {}),
      username: subject.username,
      homeDomain: subject.homeDomain,
      avatar: subject.avatar,
      banner: subject.banner,
      bio: subject.bio,
      aboutMe: subject.aboutMe,
      spaceRoles: subject.spaceRoles,
      nameColor: subject.nameColor,
      pronouns: subject.pronouns,
      birthday: subject.birthday,
      birthdayToday: subject.birthdayToday,
      joinedAtLabel: subject.joinedAtLabel,
      publicFlags: subject.publicFlags,
      bot: subject.bot,
      system: subject.system,
    };
    openUserProfileFullModal(full, { currentUserId: viewerId, onMessageUser });
    close();
  };

  const more = () => {
    void showActionSheet(
      buildUserMenuItems({
        userId: subject.userId,
        bot: subject.bot,
        username: subject.username,
        displayName: subject.displayName,
        homeDomain: subject.homeDomain,
        currentUserId: viewerId,
        onMessage: onMessageUser,
        ...(ctx ? { spaceId: ctx.spaceId } : {}),
      }),
      { title: subject.displayName },
    );
  };

  const actions = (
    <>
      {!isSelf && onMessageUser ? (
        <IconButton
          icon="paper-plane"
          label={t('friends.actions.message')}
          tone="overlay"
          onPress={() => {
            close();
            onMessageUser(subject.userId);
          }}
        />
      ) : null}
      {!isSelf ? (
        <IconButton
          icon="shield-halved"
          label={t('safety.title')}
          tone="overlay"
          onPress={() => {
            close();
            openSafetyScreen(subject.userId, subject.displayName);
          }}
        />
      ) : null}
      <IconButton icon="fa-regular fa-id-card" label={t('userArea.copyUserId')} tone="overlay" onPress={() => void copyText(subject.userId)} />
      <IconButton icon="ellipsis" label={t('mobile.ui.moreOptions')} tone="overlay" onPress={more} />
    </>
  );

  const aboutMe = subject.aboutMe?.trim();
  const hasDetails = botInstallable || !!aboutMe || !!formatBirthday(subject.birthday) || !!ctx || !!subject.spaceRoles?.length || !!subject.joinedAtLabel;

  return (
    <Sheet open={open && !!live.subject} onClose={close} scrollable padded={false} testID="profile-sheet">
      <ProfileArt
        userId={subject.userId}
        displayName={subject.displayName}
        avatar={subject.avatar}
        banner={subject.banner}
        bannerHeight={96}
        avatarSize={80}
        actions={actions}
        onAvatarPress={openFull}
        rounded
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 14 }}>
        <IdentityBlock
          compact
          displayName={subject.displayName}
          globalName={subject.globalName}
          username={subject.username}
          homeDomain={subject.homeDomain}
          bot={subject.bot}
          system={subject.system}
          publicFlags={subject.publicFlags}
          pronouns={subject.pronouns}
          isBirthday={subject.birthdayToday}
          nameColor={subject.nameColor}
          onOpenProfile={openFull}
        />
        {(isSelf && spaceId) || canEditNickname ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {isSelf && spaceId ? (
              <Button
                title={t('mobile.room.nickname.editSpaceProfile')}
                icon="id-badge"
                variant="secondary"
                size="sm"
                onPress={() => {
                  close();
                  openSpaceProfile(spaceId);
                }}
                testID="profile-edit-space-profile"
              />
            ) : null}
            {canEditNickname && spaceId ? (
              <Button
                title={t('mobile.room.nickname.change')}
                icon="pen"
                variant="secondary"
                size="sm"
                onPress={() => {
                  close();
                  presentNicknameSheet({ spaceId, userId: subject.userId });
                }}
                testID="profile-change-nickname"
              />
            ) : null}
          </View>
        ) : null}
        {hasDetails ? <Divider /> : null}
        {botInstallable ? (
          <Button
            title={t('profile.addToSpace')}
            icon="plus"
            fullWidth
            onPress={() => {
              openAppWindow(authorizeUrl({ clientId: subject.userId, scopes: ['bot'] }));
              close();
            }}
          />
        ) : null}
        {aboutMe ? (
          <View>
            <SectionLabel>{t('settings.profile.aboutMe')}</SectionLabel>
            <MessageBody text={aboutMe} roomId="" spaceId={ctx?.spaceId ?? null} allowLinkPreviews={false} inlineOnly />
          </View>
        ) : null}
        <BirthdayFact birthday={subject.birthday} />
        <RolesSection subject={subject} ctx={ctx} viewerId={viewerId} />
        {subject.joinedAtLabel ? (
          <Text variant="caption">
            <Text variant="caption" weight="medium" tone="default">
              {t('profile.joinedSpace')}
            </Text>{' '}
            {subject.joinedAtLabel}
          </Text>
        ) : null}
        <Button title={t('profile.viewFull')} variant="secondary" icon="user" fullWidth onPress={openFull} />
        {!isSelf && onMessageUser ? <QuickMessage subject={subject} onDone={close} /> : null}
      </View>
      <View style={{ height: 8, backgroundColor: theme.colors.card }} />
    </Sheet>
  );
}
