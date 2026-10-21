/// <reference types="jest" />
import './setup';
// The theme reads stores/appearance, which reaches the web store graph (lib/gif/providers ->
// stores/instance -> auth -> voice, notification prefs); those need their jest stand-ins.
import '@/data/testing/webMocks';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Avatar } from '../Avatar';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { BotTag, OfficialTag, RolePill } from '../Tags';
import { Toggle } from '../Toggle';
import { ListRow, ToggleRow } from '../List';
import { PresenceDot } from '../PresenceDot';
import { UserBadges } from '../UserBadges';
import { useLongPress } from '../useLongPress';

describe('Button', () => {
  it('presses', async () => {
    const onPress = jest.fn();
    await render(<Button title="Save" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not press while disabled, and says so', async () => {
    const onPress = jest.fn();
    await render(<Button title="Save" onPress={onPress} disabled />);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeDisabled();
    await fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('is busy and inert while loading, keeping its label', async () => {
    const onPress = jest.fn();
    await render(<Button title="Send" onPress={onPress} loading />);
    const btn = screen.getByRole('button', { name: 'Send' });
    expect(btn).toBeBusy();
    expect(btn).toBeDisabled();
    expect(screen.getByText('Send')).toBeTruthy();
    await fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('link variant is a link', async () => {
    await render(<Button title="Learn more" variant="link" onPress={() => undefined} />);
    expect(screen.getByRole('link', { name: 'Learn more' })).toBeTruthy();
  });
});

describe('Badge', () => {
  it('renders nothing for zero', async () => {
    await render(<Badge count={0} testID="b" />);
    expect(screen.queryByTestId('b')).toBeNull();
  });

  it('shows the count, capped', async () => {
    await render(
      <>
        <Badge count={7} testID="seven" />
        <Badge count={250} testID="many" />
      </>,
    );
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('99+')).toBeTruthy();
    expect(screen.getByTestId('many')).toHaveAccessibleName('99+');
  });

  it('uses a meaningful label when given', async () => {
    await render(<Badge count={3} accessibilityLabel="3 mentions" testID="b" />);
    expect(screen.getByTestId('b')).toHaveAccessibleName('3 mentions');
  });

  it('renders a dot without a number', async () => {
    await render(<Badge dot tone="foreground" testID="dot" />);
    expect(screen.getByTestId('dot')).toBeTruthy();
    expect(screen.queryByText(/\d/)).toBeNull();
  });
});

describe('Avatar', () => {
  // Avatars are decorative (hidden from screen readers) unless labelled, so query hidden too.
  const hidden = { includeHiddenElements: true };
  it('falls back to the initial without a picture', async () => {
    await render(<Avatar name="bryden" testID="av" />);
    expect(screen.getByTestId('av-initial', hidden)).toHaveTextContent('B');
    expect(screen.queryByTestId('av-image', hidden)).toBeNull();
  });

  it('shows the picture, and the initial once it fails to load', async () => {
    await render(<Avatar name="alice" uri="https://cdn.example/a.png" testID="av" />);
    const img = screen.getByTestId('av-image', hidden);
    expect(screen.queryByTestId('av-initial', hidden)).toBeNull();
    await fireEvent(img, 'error', { nativeEvent: { error: 'boom' } });
    expect(screen.getByTestId('av-initial', hidden)).toHaveTextContent('A');
  });

  it('tries again when the URL changes', async () => {
    await render(<Avatar name="alice" uri="https://cdn.example/a.png" testID="av" />);
    await fireEvent(screen.getByTestId('av-image', hidden), 'error', { nativeEvent: { error: 'boom' } });
    expect(screen.getByTestId('av-initial', hidden)).toBeTruthy();
    await screen.rerender(<Avatar name="alice" uri="https://cdn.example/b.png" testID="av" />);
    expect(screen.getByTestId('av-image', hidden)).toBeTruthy();
  });

  it('is decorative unless labelled', async () => {
    await render(<Avatar name="alice" accessibilityLabel="alice's avatar" testID="av" />);
    expect(screen.getByRole('image', { name: "alice's avatar" })).toBeTruthy();
  });
});

describe('PresenceDot', () => {
  it('announces its status when asked to', async () => {
    await render(<PresenceDot status="idle" announce testID="dot" />);
    expect(screen.getByRole('image', { name: 'Idle' })).toBeTruthy();
  });
});

describe('Tags', () => {
  it('BotTag and OfficialTag render only for their accounts', async () => {
    await render(
      <>
        <BotTag bot={false} />
        <OfficialTag />
      </>,
    );
    expect(screen.queryByTestId('bot-tag')).toBeNull();
    expect(screen.queryByTestId('official-tag')).toBeNull();
    await screen.rerender(
      <>
        <BotTag bot />
        <OfficialTag system />
      </>,
    );
    expect(screen.getByTestId('bot-tag')).toHaveAccessibleName('Bot account');
    expect(screen.getByTestId('official-tag')).toHaveAccessibleName('Official account');
  });

  it('RolePill removes', async () => {
    const onRemove = jest.fn();
    await render(<RolePill role={{ name: 'Moderator', color: 0x3ba55d }} onRemove={onRemove} removeLabel="Remove Moderator" />);
    expect(screen.getByText('Moderator')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Moderator' }));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('UserBadges', () => {
  it('names each badge and folds the rest', async () => {
    // founder | staff | contributor
    await render(<UserBadges flags={1 | 2 | 8} max={2} />);
    expect(screen.getByRole('image', { name: 'Founder' })).toBeTruthy();
    expect(screen.getByRole('image', { name: 'Staff' })).toBeTruthy();
    expect(screen.getByRole('image', { name: 'Contributor' })).toBeTruthy(); // the +1 chip, named
    expect(screen.getByText('+1')).toBeTruthy();
  });

  it('renders nothing without badges', async () => {
    await render(<UserBadges flags={0} />);
    expect(screen.queryByRole('image')).toBeNull();
  });
});

describe('Toggle', () => {
  it('flips and announces checked state', async () => {
    const onChange = jest.fn();
    await render(<Toggle value={false} onValueChange={onChange} accessibilityLabel="Compact mode" />);
    const sw = screen.getByRole('switch', { name: 'Compact mode' });
    expect(sw).not.toBeChecked();
    await fireEvent.press(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('ToggleRow toggles from anywhere on the row', async () => {
    const onChange = jest.fn();
    await render(<ToggleRow title="Notifications" value onValueChange={onChange} />);
    const row = screen.getByRole('switch', { name: 'Notifications' });
    expect(row).toBeChecked();
    await fireEvent.press(row);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('useLongPress', () => {
  function Row({ onMenu }: { onMenu: () => void }) {
    const lp = useLongPress(onMenu);
    return <ListRow title="general" onPress={() => undefined} {...lp} />;
  }

  it('long-press runs the handler with a haptic, and screen readers get the same action', async () => {
    const Haptics = jest.requireMock('expo-haptics') as { impactAsync: jest.Mock; performAndroidHapticsAsync: jest.Mock };
    Haptics.impactAsync.mockClear();
    Haptics.performAndroidHapticsAsync.mockClear();
    const onMenu = jest.fn();
    await render(<Row onMenu={onMenu} />);
    const row = screen.getByRole('button', { name: 'general' });
    await fireEvent(row, 'longPress');
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync.mock.calls.length + Haptics.performAndroidHapticsAsync.mock.calls.length).toBe(1);
    expect(row.props.accessibilityActions).toEqual([{ name: 'longpress', label: 'Show actions' }]);
    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    expect(onMenu).toHaveBeenCalledTimes(2);
  });
});
