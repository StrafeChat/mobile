/**
 * Keeps a pushed screen's content at a readable width on a tablet (centred, at most ~760 pt)
 * instead of stretching rows and cards edge to edge. A phone is unaffected.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

export const READABLE_MAX_WIDTH = 760;

export function ReadableWidth({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, width: '100%', maxWidth: READABLE_MAX_WIDTH, alignSelf: 'center' }}>{children}</View>;
}
