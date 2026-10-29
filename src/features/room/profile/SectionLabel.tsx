/** The small uppercase heading over each part of a profile (About Me, Birthday, Roles...). */
import { Text } from '@/ui';

export function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="overline" style={{ marginBottom: 6 }}>
      {children}
    </Text>
  );
}
