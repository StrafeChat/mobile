/**
 * The full profile (the web's UserProfileFullModal) as a pushed screen: banner and avatar,
 * the identity block with the instance always named, the actions Discord mobile puts under
 * the name (Message, Call, the friend button, More), what they are playing, birthday, the bio (Markdown + limited
 * HTML, drawn natively with images and media dropped), roles, when they joined, the spaces
 * you share, and "Verify encryption".
 *
 * The subject is the one the profile sheet handed over (stores/userProfileFullModal) when it
 * matches; otherwise it is built by the web's canonical builders from where the person was
 * seen (?roomId= / ?spaceId=). Seen in a space, it is their space profile there: the nickname
 * with the global name under it, and the space's avatar, banner, pronouns and bio.
 */
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createPM } from '@web/api/rooms';
import { putRelationship, removeRelationship, unblockUser } from '@web/api/relationships';
import { authorizeUrl, getPublicApplication } from '@web/api/developers';
import { openAppWindow } from '@web/lib/openWindow';
import { addOrUpdateRoom } from '@web/stores/rooms';
import { RelType, removeRelationshipLocally } from '@web/stores/relationships';
import { closeUserProfileFullModal, userProfileFullModal, type UserProfileFullSubject } from '@web/stores/userProfileFullModal';
import { confirmDialog } from '@web/stores/confirmDialog';
import { buildUserMenuItems } from '@web/lib/userContextMenu';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { useInstance, useMyId, useProfileSubject, useRelationshipType, useSpace } from '@/data';
import { openNav, openRoom, setSelectedSpaceId } from '@/shell/state';
import { joinVoiceFromUi } from '@/features/voice';
import { useTheme } from '@/theme';
import {
  Avatar,
  Button,
  Divider,
  EmptyState,
  Header,
  IconButton,
  ListRow,
  ListSection,
  RolePill,
  Text,
  showActionSheet,
  toast,
} from '@/ui';
import { backToShell, goBack, messageUser, openSafetyScreen } from '../navigation';
import { copyText, errorMessage } from '../util';
import { BioView } from './BioView';
import { IdentityBlock } from './IdentityBlock';
import { ProfileActivity } from './ProfileActivity';
import { ProfileArt } from './ProfileArt';
import { BirthdayFact, SectionLabel } from './ProfileSheetHost';
import { useMutualSpaceIds } from './mutual';
import { ReadableWidth } from '../shared/ReadableWidth';

function MutualSpaceRow({ spaceId }: { spaceId: string }) {
  const space = useSpace(spaceId);
  if (!space) return null;
  return (
    <ListRow
      title={space.name}
      leading={<Avatar uri={space.icon || undefined} name={space.name} size="md" shape="rounded" />}
      chevron
      onPress={() => {
        setSelectedSpaceId(spaceId);
        openNav();
        backToShell();
      }}
    />
  );
}

function useBotApp(userId: string, bot: boolean | undefined): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setOk(false);
    if (!bot) return;
    let live = true;
    getPublicApplication(userId)
      .then((app) => live && setOk(!!app?.has_bot && !!app?.bot_public))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [userId, bot]);
  return ok;
}

export function FullProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ userId: string; roomId?: string; spaceId?: string }>();
  const userId = String(params.userId ?? '');
  const roomId = typeof params.roomId === 'string' ? params.roomId : null;
  const spaceId = typeof params.spaceId === 'string' ? params.spaceId : null;
  const me = useMyId();
  const instanceInfo = useInstance();
  const stored = useSolid(
    () => (userProfileFullModal.subject?.userId === userId ? userProfileFullModal.subject : null),
    [userId],
  );
  const storedOnMessage = useSolid(() => (userProfileFullModal.subject?.userId === userId ? userProfileFullModal.onMessageUser : undefined), [userId]);
  const built = useProfileSubject(userId, { roomId, spaceId });
  const subject: (UserProfileFullSubject | NonNullable<typeof built>) | undefined = stored ?? built;
  const rel = useRelationshipType(userId);
  const mutual = useMutualSpaceIds(userId, me);
  const botInstallable = useBotApp(userId, subject?.bot);
  const [busy, setBusy] = useState<string | null>(null);

  // The hand-over is for this screen only; leaving it clears the store.
  useEffect(
    () => () => {
      if (userProfileFullModal.subject?.userId === userId) closeUserProfileFullModal();
    },
    [userId],
  );

  if (!subject) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <Header title={t('profile.viewFull')} onBack={goBack} />
        <EmptyState icon="user" title={t('common.unknown')} size="page" />
      </View>
    );
  }

  const isSelf = !!me && subject.userId === me;
  const canCall = !isSelf && instanceInfo.voiceEnabled && !subject.bot && !subject.system;
  const onMessage = storedOnMessage ?? ((id: string) => void messageUser(id));

  async function run(key: string, fn: () => Promise<unknown>, failKey = 'errors.unknown') {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e, failKey));
    } finally {
      setBusy(null);
    }
  }

  async function call() {
    await run('call', async () => {
      const room = await createPM(subject!.userId);
      addOrUpdateRoom(room);
      openRoom(room.id, null);
      backToShell();
      await joinVoiceFromUi(room.id, { video: false, spaceId: null });
    });
  }

  function friendButton() {
    if (isSelf || subject!.bot || subject!.system) return null;
    switch (rel) {
      case RelType.Friend:
        return <Button title={t('mobile.room.friends')} icon="user-check" variant="secondary" size="sm" disabled />;
      case RelType.OutgoingRequest:
        return <Button title={t('mobile.room.requestSent')} icon="clock" variant="secondary" size="sm" disabled />;
      case RelType.IncomingRequest:
        return (
          <Button
            title={t('userMenu.acceptFriend')}
            icon="user-plus"
            size="sm"
            loading={busy === 'friend'}
            onPress={() => void run('friend', () => putRelationship(subject!.userId))}
          />
        );
      case RelType.Blocked:
        return (
          <Button
            title={t('userMenu.unblock')}
            icon="user-check"
            variant="secondary"
            size="sm"
            loading={busy === 'friend'}
            onPress={() => void run('friend', () => unblockUser(subject!.userId))}
          />
        );
      default:
        return (
          <Button
            title={t('friends.addFriend')}
            icon="user-plus"
            variant="secondary"
            size="sm"
            loading={busy === 'friend'}
            onPress={() => void run('friend', () => putRelationship(subject!.userId))}
          />
        );
    }
  }

  function more() {
    const s = subject!;
    const items = buildUserMenuItems({
      userId: s.userId,
      bot: s.bot,
      username: s.username,
      displayName: s.displayName,
      homeDomain: s.homeDomain,
      currentUserId: me ?? undefined,
      ...(spaceId ? { spaceId } : {}),
      ...(roomId ? { roomId } : {}),
    });
    void showActionSheet(
      [
        ...items,
        !isSelf && {
          label: t('safety.title'),
          icon: 'shield-halved',
          onSelect: () => openSafetyScreen(s.userId, s.displayName),
        },
        rel === RelType.Friend && {
          label: t('friends.actions.removeFriend'),
          icon: 'user-xmark',
          danger: true,
          onSelect: async () => {
            const ok = await confirmDialog({
              title: t('friends.actions.removeFriend'),
              body: t('mobile.room.removeFriendBody', { name: s.displayName }),
              confirmLabel: t('friends.actions.removeFriend'),
              tone: 'danger',
            });
            if (!ok) return;
            await run('friend', async () => {
              await removeRelationship(s.userId);
              removeRelationshipLocally(s.userId);
            });
          },
        },
      ],
      { title: s.displayName },
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.card }}>
      <Header title={subject.displayName} onBack={goBack} border={false} />
      <ReadableWidth>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          <ProfileArt
            userId={subject.userId}
            displayName={subject.displayName}
            avatar={subject.avatar}
            banner={subject.banner}
            bannerHeight={136}
            avatarSize={92}
            actions={<IconButton icon="fa-regular fa-id-card" label={t('userArea.copyUserId')} tone="overlay" onPress={() => void copyText(subject.userId)} />}
          />
          <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 16 }}>
            <IdentityBlock
              displayName={subject.displayName}
              globalName={subject.globalName}
              username={subject.username}
              homeDomain={subject.homeDomain}
              alwaysShowDomain
              bot={subject.bot}
              system={subject.system}
              publicFlags={subject.publicFlags}
              pronouns={subject.pronouns}
              isBirthday={subject.birthdayToday}
              nameColor={subject.nameColor}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {!isSelf ? (
                <Button title={t('friends.actions.message')} icon="message" size="sm" onPress={() => onMessage(subject.userId)} />
              ) : null}
              {canCall ? (
                <Button title={t('voice.startCall')} icon="phone" size="sm" variant="secondary" loading={busy === 'call'} onPress={() => void call()} />
              ) : null}
              {friendButton()}
              {botInstallable ? (
                <Button
                  title={t('profile.addToSpace')}
                  icon="plus"
                  size="sm"
                  onPress={() => openAppWindow(authorizeUrl({ clientId: subject.userId, scopes: ['bot'] }))}
                />
              ) : null}
              <IconButton icon="ellipsis" label={t('mobile.ui.moreOptions')} onPress={more} />
            </View>
            <ProfileActivity userId={subject.userId} />
            <BirthdayFact birthday={subject.birthday} />
            <Divider />
            <View>
              <SectionLabel>{t('settings.profile.bio')}</SectionLabel>
              {subject.bio?.trim() ? <BioView source={subject.bio.trim()} /> : <Text tone="muted">{t('profile.noBio')}</Text>}
            </View>
            {subject.spaceRoles?.length ? (
              <View>
                <SectionLabel>{t('profile.roles')}</SectionLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {subject.spaceRoles.map((r) => (
                    <RolePill key={r.id} role={r} />
                  ))}
                </View>
              </View>
            ) : null}
            {subject.joinedAtLabel ? (
              <Text variant="caption">
                <Text variant="caption" weight="medium" tone="default">
                  {t('profile.joinedSpace')}
                </Text>{' '}
                {subject.joinedAtLabel}
              </Text>
            ) : null}
          </View>
          {mutual.length > 0 ? (
            <ListSection title={t('mobile.room.mutualSpaces', { count: mutual.length })} style={{ marginTop: 16 }}>
              {mutual.map((id) => (
                <MutualSpaceRow key={id} spaceId={id} />
              ))}
            </ListSection>
          ) : null}
          {!isSelf ? (
            <ListSection style={{ marginTop: 16 }}>
              <ListRow
                title={t('safety.title')}
                subtitle={t('mobile.room.safetyRowHint')}
                icon="shield-halved"
                chevron
                onPress={() => openSafetyScreen(subject.userId, subject.displayName)}
              />
            </ListSection>
          ) : null}
        </ScrollView>
      </ReadableWidth>
    </View>
  );
}
