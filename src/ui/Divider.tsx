/**
 * Divider: a hairline in the theme's border colour - between list rows, sections, header and
 * body. `inset` indents it from the start (to line up with row text after an icon or avatar).
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { withAlpha } from './color';

export interface DividerProps {
  vertical?: boolean;
  /** Start indent in points (horizontal dividers). */
  inset?: number;
  /** Space above and below (or either side when vertical). */
  spacing?: number;
  /** Fainter line (the web's border/60 menu separators). */
  subtle?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Divider({ vertical, inset = 0, spacing = 0, subtle, style }: DividerProps) {
  const theme = useTheme();
  const color = subtle ? withAlpha(theme.colors.border, 0.6) : theme.colors.border;
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      style={[
        vertical
          ? { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginHorizontal: spacing, backgroundColor: color }
          : { height: StyleSheet.hairlineWidth, marginStart: inset, marginVertical: spacing, backgroundColor: color },
        style,
      ]}
    />
  );
}
