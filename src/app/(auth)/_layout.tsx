import { Stack } from 'expo-router';
import { useTheme } from '@/theme';
import { useHorizontalSafePadding } from '@/ui';

export default function AuthLayout() {
  const theme = useTheme();
  // Clear of the cutout and a side navigation bar in landscape (the screens pad top and bottom).
  const sides = useHorizontalSafePadding();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background, ...sides } }} />;
}
