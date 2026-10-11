/**
 * Appearance (AppearanceSettingsPage): theme gallery with custom themes, text size, corners,
 * emoji style and default skin tone, density and message group spacing, and the chat options
 * that apply on a phone. Everything is the web's appearance/settings stores, per device,
 * applied at once.
 *
 * Not here, on purpose: custom CSS (no stylesheet to inject into a native app - the stored
 * value is left untouched for the web), the font choice and transparency effects (the app
 * draws with the platform's system font and opaque surfaces), and "members panel open by
 * default" (a desktop layout option; the phone's member list is a drawer).
 */
import { useMemo } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { t } from '@web/i18n/t';
import {
  MESSAGE_GROUP_SPACING_MAX,
  MESSAGE_GROUP_SPACING_MIN,
  allThemes,
  appearance,
  deleteCustomTheme,
  setCorners,
  setEmojiProvider,
  setEmojiSkinTone,
  setFontScale,
  setGifProvider,
  setMessageGroupSpacing,
  setThemeId,
  setUiDensity,
  type CornerStyle,
  type FontScale,
  type UiDensity,
} from '@web/stores/appearance';
import { setLinkPreviewsInEncrypted, setMessageCompact } from '@web/stores/settings';
import { confirmDialog } from '@web/stores/confirmDialog';
import { requestOpenExternalLink } from '@web/stores/externalLink';
import { EMOJI_ATTRIBUTIONS, EMOJI_PROVIDERS, getEmojiProvider, type EmojiProviderId } from '@web/lib/emoji/providers';
import { GIF_PROVIDERS, type GifProviderId } from '@web/lib/gif/providers';
import { SKIN_TONES } from '@web/lib/emoji/data';
import type { ThemeDefinition } from '@web/theme/themes';
import { useSolid } from '@/bridge/solid';
import { useSettings } from '@/data';
import { useTheme } from '@/theme';
import { Icon, IconButton, ListSection, SegmentedControl, Select, Text, Touchable, WIDE_BREAKPOINT, haptics, showActionSheet, withAlpha } from '@/ui';
import { LiveSlider } from '../components/LiveSlider';
import { FormCard, Note, SettingItem, SettingToggle } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { openThemeEditor } from '../navigation';

const PREVIEW_EMOJI = ['😀', '👍', '❤️', '🎉', '🐢', '🏳️‍🌈', '👨‍👩‍👧'];

/** The web's ThemePreview: canvas, a rail, two text lines and a brand button. */
export function ThemeMiniPreview({ theme: th }: { theme: ThemeDefinition }) {
  const c = th.colors;
  return (
    <View
      style={{ height: 84, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.background, overflow: 'hidden', flexDirection: 'row' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={{ width: 30, backgroundColor: c.card, alignItems: 'center', paddingTop: 8, gap: 6 }}>
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.primary }} />
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.muted }} />
      </View>
      <View style={{ flex: 1, padding: 9, gap: 5 }}>
        <View style={{ height: 6, width: 52, borderRadius: 2, backgroundColor: c.foreground }} />
        <View style={{ height: 6, width: 76, borderRadius: 2, backgroundColor: c.mutedForeground, opacity: 0.7 }} />
        <View style={{ height: 6, width: 64, borderRadius: 2, backgroundColor: c.mutedForeground, opacity: 0.7 }} />
        <View style={{ flexDirection: 'row', gap: 5, marginTop: 6 }}>
          <View style={{ height: 16, width: 38, borderRadius: 4, backgroundColor: c.primary }} />
          <View style={{ height: 16, width: 26, borderRadius: 4, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }} />
        </View>
      </View>
    </View>
  );
}

function themeActions(th: ThemeDefinition) {
  return [
    th.builtin
      ? { key: 'dup', label: t('settings.appearance.theme.duplicate', { name: th.name }), icon: 'clone', onSelect: () => openThemeEditor(th.id) }
      : { key: 'edit', label: t('settings.appearance.theme.edit', { name: th.name }), icon: 'pen', onSelect: () => openThemeEditor(th.id) },
    !th.builtin && {
      key: 'delete',
      label: t('settings.appearance.theme.delete', { name: th.name }),
      icon: 'trash',
      danger: true,
      onSelect: () => {
        void confirmDialog({
          title: t('settings.appearance.theme.deleteTitle'),
          body: t('settings.appearance.theme.deleteConfirm', { name: th.name }),
          confirmLabel: t('common.delete'),
          tone: 'danger',
          icon: 'fa-solid fa-trash',
        }).then((ok) => {
          if (ok) deleteCustomTheme(th.id);
        });
      },
    },
  ];
}

function ThemeCard({ theme: th, selected, width }: { theme: ThemeDefinition; selected: boolean; width: number }) {
  const theme = useTheme();
  const c = theme.colors;
  const kind = th.builtin ? (th.description ?? t('settings.appearance.theme.builtIn')) : t('settings.appearance.theme.custom');
  const mode = th.appearance === 'light' ? t('settings.appearance.theme.light') : t('settings.appearance.theme.dark');
  const openMenu = () => {
    haptics.longPress();
    void showActionSheet(themeActions(th), { title: th.name });
  };
  return (
    <Touchable
      feedback="opacity"
      onPress={() => {
        haptics.selection();
        setThemeId(th.id);
      }}
      onLongPress={openMenu}
      accessibilityRole="radio"
      accessibilityLabel={`${th.name}, ${kind}, ${mode}`}
      accessibilityState={{ checked: selected }}
      accessibilityActions={[{ name: 'longpress', label: t('mobile.settings.themeActions') }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'longpress') openMenu();
      }}
      style={{
        width,
        padding: 8,
        borderRadius: theme.radii.xl,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? withAlpha(c.primary, 0.7) : c.border,
        backgroundColor: selected ? withAlpha(c.primary, 0.1) : c.card,
      }}
    >
      <ThemeMiniPreview theme={th} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 8, paddingHorizontal: 2 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label" weight="semibold" numberOfLines={1}>
            {th.name}
          </Text>
          <Text variant="caption" numberOfLines={1}>
            {kind} · {mode}
          </Text>
        </View>
        {selected ? <Icon name="circle-check" size={16} tone="primary" /> : null}
        <IconButton icon="ellipsis" label={t('mobile.settings.themeActions')} size="sm" tone="subtle" onPress={openMenu} />
      </View>
    </Touchable>
  );
}

function NewThemeCard({ width, onPress }: { width: number; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Touchable
      feedback="opacity"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t('settings.appearance.theme.new')}, ${t('settings.appearance.theme.newHint')}`}
      style={{
        width,
        minHeight: 140,
        borderRadius: theme.radii.xl,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: 12,
      }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.muted, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="plus" size={14} tone="muted" />
      </View>
      <Text variant="label">{t('settings.appearance.theme.new')}</Text>
      <Text variant="caption" align="center">
        {t('settings.appearance.theme.newHint')}
      </Text>
    </Touchable>
  );
}

/** One emoji in the chosen artwork set (the instance's CDN), or the system font. */
export function EmojiSample({ emoji, provider, size = 28 }: { emoji: string; provider: EmojiProviderId; size?: number }) {
  const p = getEmojiProvider(provider);
  if (!p.imageUrl) {
    return (
      <Text style={{ fontSize: size * 0.85, lineHeight: size }} accessibilityLabel={emoji}>
        {emoji}
      </Text>
    );
  }
  return <Image source={{ uri: p.imageUrl(emoji) }} style={{ width: size, height: size }} contentFit="contain" accessibilityLabel={emoji} />;
}

export function AppearanceScreen() {
  useLocale();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const settings = useSettings();
  const a = useSolid(() => ({
    themeId: appearance.themeId,
    fontScale: appearance.fontScale,
    corners: appearance.corners,
    uiDensity: appearance.uiDensity,
    messageGroupSpacing: appearance.messageGroupSpacing,
    emojiProvider: appearance.emojiProvider,
    emojiSkinTone: appearance.emojiSkinTone,
    gifProvider: appearance.gifProvider,
    customThemes: appearance.customThemes.length,
  }));
  const themes = useSolid(() => allThemes());
  const columns = width >= WIDE_BREAKPOINT ? 3 : 2;
  const contentWidth = Math.min(width, 720) - 24;
  const cardWidth = Math.floor((contentWidth - (columns - 1) * 10) / columns);
  const current = themes.find((th) => th.id === a.themeId) ?? null;
  const provider = getEmojiProvider(a.emojiProvider);

  const emojiOptions = useMemo(() => EMOJI_PROVIDERS.map((p) => ({ value: p.id, label: p.name, description: t(`emoji.providers.${p.id}`) })), []);

  return (
    <SettingsScreen
      title={t('settings.sections.appearance.title')}
      actions={[{ icon: 'plus', label: t('settings.appearance.theme.create'), onPress: () => openThemeEditor(current?.id ?? null) }]}
      testID="settings-appearance"
    >
      <ListSection title={t('settings.appearance.theme.title')} card={false}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 12 }} accessibilityRole="radiogroup">
          {themes.map((th) => (
            <ThemeCard key={th.id} theme={th} selected={th.id === a.themeId} width={cardWidth} />
          ))}
          <NewThemeCard width={cardWidth} onPress={() => openThemeEditor(current?.id ?? null)} />
        </View>
      </ListSection>

      <ListSection title={t('settings.appearance.styling')}>
        <SettingItem icon="text-height" title={t('settings.appearance.textSize.title')} description={t('settings.appearance.textSize.description')} />
        <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
          <SegmentedControl<FontScale>
            value={a.fontScale}
            onChange={setFontScale}
            accessibilityLabel={t('settings.appearance.textSize.title')}
            items={[
              { id: 'sm', label: t('settings.appearance.textSize.small') },
              { id: 'md', label: t('settings.appearance.textSize.default') },
              { id: 'lg', label: t('settings.appearance.textSize.large') },
            ]}
          />
        </View>
        <SettingItem icon="border-top-left" title={t('settings.appearance.corners.title')} description={t('settings.appearance.corners.description')} />
        <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
          <SegmentedControl<CornerStyle>
            value={a.corners}
            onChange={setCorners}
            accessibilityLabel={t('settings.appearance.corners.title')}
            items={[
              { id: 'sharp', label: t('settings.appearance.corners.sharp') },
              { id: 'soft', label: t('settings.appearance.corners.soft') },
              { id: 'round', label: t('settings.appearance.corners.round') },
            ]}
          />
        </View>
      </ListSection>

      <ListSection title={t('settings.appearance.emoji.title')}>
        <View style={{ padding: 16, gap: 14 }}>
          <Select<EmojiProviderId>
            label={t('settings.appearance.emoji.style')}
            value={a.emojiProvider}
            options={emojiOptions}
            onValueChange={setEmojiProvider}
            hint={t(`emoji.providers.${provider.id}`)}
          />
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 10, borderRadius: theme.radii.md, backgroundColor: theme.colors.muted }}
            accessible
            accessibilityLabel={t('settings.appearance.emoji.preview')}
          >
            {PREVIEW_EMOJI.map((e) => (
              <EmojiSample key={e} emoji={e} provider={a.emojiProvider} />
            ))}
          </View>
          <View style={{ gap: 4 }}>
            <Text variant="caption">{t('settings.appearance.emoji.attribution')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {EMOJI_ATTRIBUTIONS.map((at) => (
                <Text key={at.id} variant="caption">
                  <Text variant="caption" tone="link" accessibilityRole="link" onPress={() => requestOpenExternalLink(at.sourceUrl)}>
                    {at.name}
                  </Text>{' '}
                  (
                  <Text variant="caption" tone="link" accessibilityRole="link" onPress={() => requestOpenExternalLink(at.licenseUrl)}>
                    {at.license}
                  </Text>
                  )
                </Text>
              ))}
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <Text variant="label">{t('settings.appearance.emoji.skinTone')}</Text>
            <Text variant="caption">{t('settings.appearance.emoji.skinToneDescription')}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup" accessibilityLabel={t('settings.appearance.emoji.skinTone')}>
              {SKIN_TONES.map((tone) => {
                const on = a.emojiSkinTone === tone.tone;
                return (
                  <Touchable
                    key={tone.tone}
                    feedback="opacity"
                    onPress={() => {
                      haptics.selection();
                      setEmojiSkinTone(tone.tone);
                    }}
                    accessibilityRole="radio"
                    accessibilityLabel={t(`emoji.skinTones.${tone.tone}`)}
                    accessibilityState={{ checked: on }}
                    hitSlop={6}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      backgroundColor: tone.swatch,
                      borderWidth: on ? 3 : 1,
                      borderColor: on ? theme.colors.primary : withAlpha(theme.colors.foreground, 0.15),
                    }}
                  />
                );
              })}
            </View>
          </View>
        </View>
      </ListSection>

      <ListSection title={t('settings.appearance.density.title')}>
        <SettingItem icon="up-right-and-down-left-from-center" title={t('settings.appearance.density.uiDensity')} description={t('settings.appearance.density.uiDensityDescription')} />
        <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
          <SegmentedControl<UiDensity>
            value={a.uiDensity}
            onChange={setUiDensity}
            accessibilityLabel={t('settings.appearance.density.uiDensity')}
            items={[
              { id: 'compact', label: t('settings.appearance.density.compact') },
              { id: 'default', label: t('settings.appearance.density.default') },
              { id: 'spacious', label: t('settings.appearance.density.spacious') },
            ]}
          />
        </View>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 4 }}>
          <LiveSlider
            label={t('settings.appearance.density.messageGroupSpacing')}
            min={MESSAGE_GROUP_SPACING_MIN}
            max={MESSAGE_GROUP_SPACING_MAX}
            value={a.messageGroupSpacing}
            format={(v) => `${v}px`}
            onCommit={setMessageGroupSpacing}
          />
          <Text variant="caption">{t('settings.appearance.density.messageGroupSpacingDescription')}</Text>
        </View>
      </ListSection>

      <ListSection title={t('settings.appearance.chat.title')}>
        <SettingToggle
          icon="compress"
          title={t('settings.appearance.chat.compact')}
          description={t('settings.appearance.chat.compactDescription')}
          value={!!settings.messageCompact}
          onValueChange={setMessageCompact}
          testID="appearance-compact"
        />
        <SettingToggle
          icon="link"
          title={t('settings.appearance.chat.linkPreviewsEncrypted')}
          description={t('settings.appearance.chat.linkPreviewsEncryptedDescription')}
          value={!!settings.linkPreviewsInEncrypted}
          onValueChange={setLinkPreviewsInEncrypted}
          testID="appearance-link-previews"
        />
      </ListSection>

      <FormCard style={{ marginBottom: 16 }}>
        <Select<GifProviderId>
          label={t('settings.appearance.gif.title')}
          hint={t('settings.appearance.gif.description')}
          value={a.gifProvider}
          options={GIF_PROVIDERS.map((p) => ({ value: p.id, label: p.name }))}
          onValueChange={setGifProvider}
        />
      </FormCard>

      <Note>{t('mobile.settings.appearanceWebOnly')}</Note>
    </SettingsScreen>
  );
}
