/**
 * Renders promptText(): one field in a bottom sheet, with Cancel and the confirm button.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { Button, Input, Sheet, useExternalStore } from '@/ui';
import { settleTextPrompt, textPromptStore, type TextPromptRequest } from './presenters';

export function TextPromptHost() {
  const request = useExternalStore(textPromptStore);
  const last = useRef<TextPromptRequest | null>(request);
  if (request) last.current = request;
  const shown = last.current;
  const [value, setValue] = useState('');
  useEffect(() => {
    if (request) setValue(request.initial);
  }, [request]);

  const submit = () => {
    if (!request || !value.trim()) return;
    settleTextPrompt(request.id, value);
  };

  return (
    <Sheet
      open={!!request}
      onClose={() => {
        const cur = textPromptStore.get();
        if (cur) settleTextPrompt(cur.id, null);
      }}
      title={shown?.title}
      description={shown?.description}
      testID="text-prompt"
    >
      <View style={{ gap: 14, paddingTop: 8 }}>
        <Input
          label={shown?.label}
          placeholder={shown?.placeholder}
          value={value}
          onChangeText={setValue}
          maxLength={shown?.maxLength}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title={t('common.cancel')} variant="ghost" style={{ flex: 1 }} onPress={() => request && settleTextPrompt(request.id, null)} />
          <Button title={shown?.confirmLabel ?? t('common.save')} style={{ flex: 1 }} disabled={!value.trim()} onPress={submit} />
        </View>
      </View>
    </Sheet>
  );
}
