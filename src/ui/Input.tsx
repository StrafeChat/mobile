/**
 * Text fields: Input, TextArea and SearchInput, on the web's shared field surface
 * (inputBaseClass) - one border, fill, radius and focus ring for every text box in the app.
 *
 * - `label` sits above, `error` below in red with an icon (announced when it appears, which is
 *   what the web's FieldError fix was about: errors arrive after mount), `hint` below in grey.
 * - `secureTextEntry` gets a show/hide button.
 * - Inside a `<Sheet>` these render the bottom-sheet library's TextInput, which keeps the sheet
 *   above the keyboard; elsewhere a plain TextInput. Nothing to choose at the call site.
 * - Text scales with the Appearance font scale and the system text size.
 *
 * `ref` reaches the underlying TextInput (focus(), blur(), clear()).
 */
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useEffect, useRef, useState, type ComponentType, type ReactNode, type Ref } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { t } from '@web/i18n/t';
import { useTheme, type Theme } from '@/theme';
import { withAlpha } from './color';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { useInSheet } from './Sheet';
import { Text, textStyle } from './Text';

type FieldComponent = ComponentType<TextInputProps & { ref?: Ref<TextInput> }>;

function useFieldComponent(): FieldComponent {
  return (useInSheet() ? BottomSheetTextInput : TextInput) as unknown as FieldComponent;
}

/**
 * Body text for a text field, without a line height. A TextInput with lineHeight set (or
 * set to `undefined` in a later style, which Fabric on Android reads as 0) clips or hides its
 * text, so fields leave line height to the platform.
 */
function withoutLineHeight(style: TextStyle): TextStyle {
  const { lineHeight: _omit, ...rest } = style;
  return rest;
}

function fieldTextStyle(theme: Theme): TextStyle {
  return withoutLineHeight(textStyle(theme, 'body'));
}

/** The field box: border by state, translucent background fill, theme radius. */
export function fieldBoxStyle(theme: Theme, state: { focused?: boolean; error?: boolean; disabled?: boolean }): ViewStyle {
  const c = theme.colors;
  return {
    borderWidth: 1,
    borderColor: state.error ? c.destructive : state.focused ? withAlpha(c.ring, 0.8) : c.input,
    backgroundColor: withAlpha(c.background, 0.8),
    borderRadius: theme.radii.md,
    opacity: state.disabled ? 0.5 : 1,
  };
}

export function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Text variant="label" accessibilityElementsHidden importantForAccessibility="no">
      {label}
      {required ? (
        <Text variant="label" tone="danger">
          {' *'}
        </Text>
      ) : null}
    </Text>
  );
}

/** Red error line with an icon; announced to screen readers when it appears or changes. */
export function FieldError({ message }: { message?: string | null }) {
  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility?.(message);
  }, [message]);
  if (!message) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
      <Icon name="circle-exclamation" size={12} tone="danger" style={{ marginTop: 2 }} />
      <Text variant="caption" tone="danger" style={{ flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}

function a11yName(label: string | undefined, required: boolean | undefined, fallback?: string): string | undefined {
  const name = label ?? fallback;
  if (!name) return undefined;
  return required ? `${name}, ${t('mobile.ui.required')}` : name;
}

type FocusEvt = Parameters<NonNullable<TextInputProps['onFocus']>>[0];
type BlurEvt = Parameters<NonNullable<TextInputProps['onBlur']>>[0];

function useFocus(props: Pick<TextInputProps, 'onFocus' | 'onBlur'>) {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    onFocus: (e: FocusEvt) => {
      setFocused(true);
      props.onFocus?.(e);
    },
    onBlur: (e: BlurEvt) => {
      setFocused(false);
      props.onBlur?.(e);
    },
  };
}

export interface InputProps extends Omit<TextInputProps, 'style' | 'editable'> {
  label?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  /** Icon inside the field, at the start. */
  leftIcon?: string;
  /** Node inside the field, at the end (a unit, a button). */
  right?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  ref?: Ref<TextInput>;
}

export function Input({
  label,
  error,
  hint,
  required,
  disabled,
  leftIcon,
  right,
  containerStyle,
  inputStyle,
  secureTextEntry,
  ref,
  ...rest
}: InputProps) {
  const theme = useTheme();
  const Field = useFieldComponent();
  const focus = useFocus(rest);
  const [revealed, setRevealed] = useState(false);
  const secure = !!secureTextEntry && !revealed;

  return (
    <View style={[{ gap: 6, alignSelf: 'stretch' }, containerStyle]}>
      {label ? <FieldLabel label={label} required={required} /> : null}
      <View style={[{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }, fieldBoxStyle(theme, { focused: focus.focused, error: !!error, disabled })]}>
        {leftIcon ? <Icon name={leftIcon} size={14} tone="muted" style={{ marginStart: 12 }} /> : null}
        <Field
          ref={ref}
          editable={!disabled}
          placeholderTextColor={theme.colors.mutedForeground}
          selectionColor={theme.colors.primary}
          cursorColor={theme.colors.primary}
          accessibilityLabel={a11yName(label, required, rest.placeholder)}
          accessibilityHint={error ?? hint}
          accessibilityState={{ disabled: !!disabled }}
          {...rest}
          secureTextEntry={secure}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          style={[
            fieldTextStyle(theme),
            { flex: 1, color: theme.colors.foreground, paddingHorizontal: 12, paddingVertical: 10 },
            inputStyle,
          ]}
        />
        {secureTextEntry ? (
          <IconButton
            icon={revealed ? 'eye-slash' : 'eye'}
            label={revealed ? t('mobile.ui.hidePassword') : t('mobile.ui.showPassword')}
            onPress={() => setRevealed((v) => !v)}
            size="sm"
            style={{ marginEnd: 6 }}
          />
        ) : null}
        {right ? <View style={{ marginEnd: 8 }}>{right}</View> : null}
      </View>
      {error ? <FieldError message={error} /> : hint ? <Text variant="caption">{hint}</Text> : null}
    </View>
  );
}

export interface TextAreaProps extends InputProps {
  /** Visible lines before it starts growing (default 3). */
  minRows?: number;
  /** Lines it grows to before scrolling (default 8). */
  maxRows?: number;
  /** Show the remaining-characters counter when `maxLength` is set (default true). */
  showCount?: boolean;
}

export function TextArea({
  label,
  error,
  hint,
  required,
  disabled,
  containerStyle,
  inputStyle,
  minRows = 3,
  maxRows = 8,
  showCount = true,
  maxLength,
  value,
  onChangeText,
  ref,
  ...rest
}: TextAreaProps) {
  const theme = useTheme();
  const Field = useFieldComponent();
  const focus = useFocus(rest);
  const [uncontrolledLength, setUncontrolledLength] = useState((rest.defaultValue ?? '').length);
  const length = value !== undefined ? value.length : uncontrolledLength;
  const line = theme.font(20);
  const counter = showCount && maxLength ? maxLength - length : null;

  return (
    <View style={[{ gap: 6, alignSelf: 'stretch' }, containerStyle]}>
      {label ? <FieldLabel label={label} required={required} /> : null}
      <View style={fieldBoxStyle(theme, { focused: focus.focused, error: !!error, disabled })}>
        <Field
          ref={ref}
          multiline
          editable={!disabled}
          maxLength={maxLength}
          value={value}
          onChangeText={(v) => {
            if (value === undefined) setUncontrolledLength(v.length);
            onChangeText?.(v);
          }}
          textAlignVertical="top"
          placeholderTextColor={theme.colors.mutedForeground}
          selectionColor={theme.colors.primary}
          cursorColor={theme.colors.primary}
          accessibilityLabel={a11yName(label, required, rest.placeholder)}
          accessibilityHint={error ?? hint}
          {...rest}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          style={[
            textStyle(theme, 'body'),
            {
              color: theme.colors.foreground,
              paddingHorizontal: 12,
              paddingTop: 10,
              paddingBottom: 10,
              minHeight: line * minRows + 20,
              maxHeight: line * maxRows + 20,
            },
            inputStyle,
          ]}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>{error ? <FieldError message={error} /> : hint ? <Text variant="caption">{hint}</Text> : null}</View>
        {counter !== null ? (
          <Text
            variant="caption"
            tone={counter < 0 ? 'danger' : 'muted'}
            style={{ fontVariant: ['tabular-nums'] }}
            accessibilityLabel={t('mobile.ui.charactersLeft', { count: Math.max(0, counter) })}
          >
            {length}/{maxLength}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export interface SearchInputProps extends Omit<TextInputProps, 'style' | 'value' | 'onChangeText'> {
  value: string;
  onValueChange: (value: string) => void;
  /** `sm` for headers, `md` for pages and sheets. */
  size?: 'sm' | 'md';
  /** Submit (the keyboard's search key). */
  onSubmit?: (value: string) => void;
  containerStyle?: StyleProp<ViewStyle>;
  ref?: Ref<TextInput>;
}

export function SearchInput({ value, onValueChange, size = 'md', onSubmit, containerStyle, placeholder, ref, ...rest }: SearchInputProps) {
  const theme = useTheme();
  const Field = useFieldComponent();
  const inner = useRef<TextInput | null>(null);
  const focus = useFocus(rest);
  const height = size === 'sm' ? 36 : 40;
  const ph = placeholder ?? t('common.search');

  const setRef = (node: TextInput | null) => {
    inner.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref && typeof ref === 'object') (ref as { current: TextInput | null }).current = node;
  };

  return (
    // The surrounding press area brings the target to 44 pt and focuses the field.
    <Pressable
      onPress={() => inner.current?.focus()}
      accessible={false}
      style={[{ paddingVertical: (44 - height) / 2, alignSelf: 'stretch' }, containerStyle]}
    >
      <View style={[{ flexDirection: 'row', alignItems: 'center', height }, fieldBoxStyle(theme, { focused: focus.focused })]}>
        <Icon name="magnifying-glass" size={size === 'sm' ? 12 : 14} tone="muted" style={{ marginStart: 12 }} />
        <Field
          ref={setRef}
          value={value}
          onChangeText={onValueChange}
          placeholder={ph}
          placeholderTextColor={theme.colors.mutedForeground}
          selectionColor={theme.colors.primary}
          cursorColor={theme.colors.primary}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={ph}
          onSubmitEditing={(e) => onSubmit?.(e.nativeEvent.text)}
          {...rest}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          style={[withoutLineHeight(textStyle(theme, size === 'sm' ? 'label' : 'body', 'regular')), { flex: 1, color: theme.colors.foreground, paddingHorizontal: 8, paddingVertical: 0 }]}
        />
        {value ? (
          <IconButton
            icon="circle-xmark"
            label={t('common.clear')}
            size="sm"
            onPress={() => {
              onValueChange('');
              inner.current?.focus();
            }}
            style={{ marginEnd: 2 }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}
