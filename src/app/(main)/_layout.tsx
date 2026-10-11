import { Stack } from 'expo-router';
import { useTheme } from '@/theme';

export default function MainLayout() {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }} />;
}
