/**
 * Theme editor (ThemeEditorDialog), as a full screen: name, dark/light mode, the 20 colour
 * tokens grouped like the web's, JSON import (paste) / export (copy or share), and reset to the
 * theme it started from. Every change previews live across the whole app through the
 * appearance store's preview theme, which is cleared when the screen goes away.
 *
 * A custom theme opened here is edited in place; a built-in one (or none) becomes a new theme.
 */
import { useEffect, useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { t } from '@web/i18n/t';
import { allThemes, newCustomThemeId, saveCustomTheme, setPreviewTheme } from '@web/stores/appearance';
import { THEME_TOKEN_GROUPS, THEME_TOKENS, exportTheme, parseThemeJson, type ThemeColors, type ThemeDefinition, type ThemeTokenKey } from '@web/theme/themes';
import { Button, Input, ListSection, SegmentedControl, Text, TextArea, toast } from '@/ui';
import { ColorField } from '../components/ColorField';
import { FormCard, SectionTitle } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { useCopy } from '../hooks/useCopy';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import { ThemeMiniPreview } from './AppearanceScreen';

function tokenLabel(tok: { key: string; label: string }): string {
  return t(`themeEditor.tokens.${tok.key}.label`, { defaultValue: tok.label });
}
function tokenHint(tok: { key: string; hint: string }): string {
  return t(`themeEditor.tokens.${tok.key}.hint`, { defaultValue: tok.hint });
}

/** The draft the editor starts with for a base theme (the web's seeding rules). */
export function seedThemeDraft(base: ThemeDefinition | null, fallbackColors: ThemeColors): ThemeDefinition {
  const editing = !!base && !base.builtin;
  return {
    id: editing ? base.id : newCustomThemeId(),
    name: editing ? base.name : base ? t('themeEditor.copyName', { name: base.name }) : t('themeEditor.defaultName'),
    appearance: base?.appearance ?? 'dark',
    colors: { ...(base?.colors ?? fallbackColors) },
  };
}

export function ThemeEditorScreen() {
  useLocale();
  const params = useLocalSearchParams<{ base?: string }>();
  const base = useMemo(() => allThemes().find((th) => th.id === params.base) ?? null, [params.base]);
  const initial = useMemo(() => seedThemeDraft(base, allThemes()[0]!.colors), [base]);
  const [draft, setDraft] = useState<ThemeDefinition>(initial);
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const { copy, copied } = useCopy();
  const editingCustom = !!base && !base.builtin;

  useUnsavedGuard(dirty && !leaving);

  // Live preview while the editor is open.
  useEffect(() => {
    setPreviewTheme({ id: draft.id, name: draft.name, appearance: draft.appearance, colors: { ...draft.colors } });
  }, [draft]);
  useEffect(() => () => setPreviewTheme(null), []);

  useEffect(() => {
    if (leaving) {
      if (router.canGoBack()) router.back();
    }
  }, [leaving]);

  const change = (patch: Partial<ThemeDefinition>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const setColor = (key: ThemeTokenKey, hex: string) => {
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: hex } }));
    setDirty(true);
  };

  function save() {
    if (!draft.name.trim()) return;
    saveCustomTheme({ id: draft.id, name: draft.name, appearance: draft.appearance, colors: { ...draft.colors } });
    toast.success(t('mobile.settings.themeSaved'));
    setLeaving(true);
  }

  function applyImport(text: string) {
    const res = parseThemeJson(text, draft.colors);
    if (!res.ok) {
      setImportError(res.error);
      return;
    }
    setImportError('');
    change({ name: res.theme.name, appearance: res.theme.appearance, colors: { ...res.theme.colors } });
    setImportOpen(false);
    setImportText('');
  }

  async function pasteFromClipboard() {
    const text = await Clipboard.getStringAsync().catch(() => '');
    if (!text.trim()) {
      setImportError(t('mobile.settings.clipboardEmpty'));
      return;
    }
    setImportText(text);
    applyImport(text);
  }

  const json = exportTheme(draft);

  return (
    <SettingsScreen
      title={editingCustom ? t('themeEditor.editTitle') : t('themeEditor.createTitle')}
      right={
        <Button
          title={editingCustom ? t('common.save') : t('themeEditor.saveTheme')}
          size="sm"
          disabled={!draft.name.trim()}
          onPress={save}
          testID="theme-save"
        />
      }
      testID="settings-theme-editor"
    >
      <Text variant="caption" style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        {t('themeEditor.description')}
      </Text>
      <FormCard style={{ marginBottom: 16 }}>
        <ThemeMiniPreview theme={draft} />
        <Input
          label={t('common.name')}
          value={draft.name}
          maxLength={60}
          placeholder={t('themeEditor.defaultName')}
          onChangeText={(v) => change({ name: v })}
          testID="theme-name"
        />
        <View style={{ gap: 6 }}>
          <Text variant="label">{t('themeEditor.mode')}</Text>
          <SegmentedControl<'dark' | 'light'>
            value={draft.appearance}
            onChange={(v) => change({ appearance: v })}
            accessibilityLabel={t('themeEditor.mode')}
            items={[
              { id: 'dark', label: t('settings.appearance.theme.dark') },
              { id: 'light', label: t('settings.appearance.theme.light') },
            ]}
          />
        </View>
      </FormCard>

      {THEME_TOKEN_GROUPS.map((group) => (
        <View key={group} style={{ marginBottom: 16 }}>
          <SectionTitle title={t(`themeEditor.groups.${group}`, { defaultValue: group })} />
          <FormCard gap={18}>
            {THEME_TOKENS.filter((tok) => tok.group === group).map((tok) => (
              <View key={tok.key} style={{ gap: 2 }}>
                <ColorField name={tokenLabel(tok)} label={tokenLabel(tok)} value={draft.colors[tok.key]} onChange={(hex) => setColor(tok.key, hex)} testID={`theme-token-${tok.key}`} />
                <Text variant="caption">{tokenHint(tok)}</Text>
              </View>
            ))}
          </FormCard>
        </View>
      ))}

      <ListSection title={t('mobile.settings.themeTools')} card={false}>
        <FormCard>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button title={t('themeEditor.importJson')} icon="file-import" variant="outline" size="sm" onPress={() => setImportOpen((o) => !o)} />
            <Button
              title={copied('json') ? t('common.copied') : t('themeEditor.copyJson')}
              icon={copied('json') ? 'check' : 'copy'}
              variant="outline"
              size="sm"
              onPress={() => void copy('json', json)}
            />
            <Button title={t('mobile.settings.share')} icon="share-nodes" variant="outline" size="sm" onPress={() => void Share.share({ message: json }).catch(() => undefined)} />
            {base ? (
              <Button
                title={t('themeEditor.resetTo', { name: base.name })}
                variant="ghost"
                size="sm"
                onPress={() => change({ colors: { ...base.colors }, appearance: base.appearance })}
              />
            ) : null}
          </View>
          {importOpen ? (
            <View style={{ gap: 10 }}>
              <TextArea
                value={importText}
                onChangeText={(v) => {
                  setImportText(v);
                  setImportError('');
                }}
                placeholder='{"name": "…", "appearance": "dark", "colors": { "primary": "#509b6b" }}'
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                showCount={false}
                minRows={4}
                error={importError || undefined}
                accessibilityLabel={t('themeEditor.importJson')}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title={t('mobile.settings.pasteFromClipboard')} icon="paste" variant="outline" size="sm" onPress={() => void pasteFromClipboard()} />
                <Button title={t('themeEditor.loadIntoEditor')} size="sm" disabled={!importText.trim()} onPress={() => applyImport(importText)} />
              </View>
            </View>
          ) : null}
        </FormCard>
      </ListSection>
    </SettingsScreen>
  );
}
