/**
 * Swipe-to-reply against the shell's gestures: the reply pan never begins in the right-edge
 * strip (the member list's swipe), and only a leftward drag past its travel takes it.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { describe, expect, jest, test } from '@jest/globals';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

const mockGestures: { config: Record<string, unknown> }[] = [];
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual<Record<string, unknown>>('react-native-gesture-handler');
  return {
    ...actual,
    GestureDetector: ({ gesture, children }: { gesture: { config: Record<string, unknown> }; children: ReactNode }) => {
      mockGestures.push(gesture);
      return children;
    },
  };
});

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useIsFocused: () => true }));

// After the mocks.
const { SwipeToReply, EDGE_ZONE_PX } = require('../row/SwipeToReply') as typeof import('../row/SwipeToReply');

describe('swipe to reply', () => {
  test('leaves the right-edge strip to the shell and activates only on deliberate leftward travel', async () => {
    await render(
      <SwipeToReply enabled onReply={() => undefined}>
        <Text>row</Text>
      </SwipeToReply>,
    );
    const g = mockGestures.at(-1)!;
    expect(EDGE_ZONE_PX).toBeGreaterThanOrEqual(40);
    expect(g.config.hitSlop).toEqual({ right: -EDGE_ZONE_PX });
    // Leftward only: rightward movement fails it (the shell's way back to the rooms).
    expect(g.config.activeOffsetXStart).toBeLessThanOrEqual(-14);
    expect(g.config.failOffsetXEnd).toBeGreaterThan(0);
  });

  test('a row that cannot be replied to has no gesture at all', async () => {
    mockGestures.length = 0;
    await render(
      <SwipeToReply enabled={false} onReply={() => undefined}>
        <Text>row</Text>
      </SwipeToReply>,
    );
    expect(mockGestures).toHaveLength(0);
  });
});
