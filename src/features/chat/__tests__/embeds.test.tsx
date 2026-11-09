/**
 * A bot's rich embeds: the card (author, title through the external-link guard, markdown
 * description with mentions drawn as pills, the field rows, footer), pictures only from the
 * instance (proxy or own CDN) with a click-to-load placeholder otherwise, reduced motion (every
 * picture, whatever its URL says), and the row's rules - plain rooms only, the reader's setting,
 * an embedded attachment not shown twice (on a mirror too), no preview card for the embed's own
 * link (however it is written).
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Embed } from '@web/api/messages';
import { setRooms } from '@web/stores/rooms';
import { setSpaces } from '@web/stores/spaces';
import { setMessages } from '@web/stores/messages';
import { setBotEmbeds } from '@web/stores/settings';
import { setReduceMotion } from '@web/stores/appearance';
import { apiUrl, cdnUrl } from '@web/lib/runtimeConfig';
import { attachmentsBesideEmbeds, previewUrlsBesideEmbeds } from '@web/lib/embeds/messageEmbeds';
import { message, pm, resetStores, sroom, user } from '@/data/testing/fixtures';
import { embedsShown } from '@/data';
import { ListContext, type ListContextValue } from '../row/listContext';

// Every picture as a View naming the URL it would load, and whether it would animate (its
// onLoad kept, so a test can say the bytes came).
jest.mock('expo-image', () => {
  const React = require('react');
  const RN = require('react-native');
  return {
    Image: (p: { source?: { uri?: string }; accessibilityLabel?: string; autoplay?: boolean; onLoad?: unknown }) =>
      React.createElement(RN.View, { testID: `img:${p.source?.uri ?? ''}`, accessibilityLabel: p.accessibilityLabel, autoplay: p.autoplay, onLoad: p.onLoad }),
  };
});
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({ addListener: () => ({ remove: () => undefined }) }), VideoView: () => null }));
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ play: () => undefined, pause: () => undefined, seekTo: async () => undefined, setPlaybackRate: () => undefined }),
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0, didJustFinish: false, isBuffering: false, mute: false, playbackRate: 1, error: null }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, canDismiss: () => false }, Stack: { Screen: () => null } }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true), getStringAsync: jest.fn(async () => '') }));
jest.mock('@web/stores/externalLink', () => ({ isExternalLink: () => true, requestOpenExternalLink: jest.fn() }));
jest.mock('@/features/composer', () => ({ EmojiPickerSheet: () => null }));
jest.mock('@/platform/media', () => ({
  useAttachmentSource: () => ({ status: 'loading', progress: null }),
  attachmentSourceSync: () => null,
  saveAttachmentToDevice: jest.fn(),
  shareAttachment: jest.fn(),
  playExclusive: jest.fn(),
  useExclusivePlayback: () => undefined,
}));
jest.mock('@/platform/rooms', () => ({ spaceIdOfRoom: () => null }));
const mockUnfurl = jest.fn(async (url: string) => ({ url, title: 'Unfurled page' }));
jest.mock('@web/api/unfurl', () => ({ fetchUnfurl: (url: string) => mockUnfurl(url) }));

// After the mocks.
const { MessageEmbeds, fieldRows } = require('../body/MessageEmbed') as typeof import('../body/MessageEmbed');
const { MessageRow } = require('../row/MessageRow') as typeof import('../row/MessageRow');
const externalLink = require('@web/stores/externalLink') as { requestOpenExternalLink: jest.Mock };

const CTX: ListContextValue = {
  roomId: 'r',
  spaceId: null,
  compact: false,
  allowLinkPreviews: true,
  showEmbeds: true,
  canReply: true,
  canReact: true,
  canJoinReactions: true,
  groupSpacing: 16,
};

function card(embeds: Embed[]) {
  return render(<MessageEmbeds embeds={embeds} roomId="r" spaceId={null} />);
}

async function row(id: string, ctx: Partial<ListContextValue> = {}) {
  await render(
    <ListContext.Provider value={{ ...CTX, ...ctx }}>
      <MessageRow item={{ kind: 'message', key: id, id, senderId: '7', showHeader: true, groupStart: false, mentionsMe: false, system: false, pending: false }} />
    </ListContext.Provider>,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  setRooms({ rooms: [pm('r', user('7', { bot: true }), { e2ee_enabled: false })] });
  externalLink.requestOpenExternalLink.mockClear();
  mockUnfurl.mockClear();
});

afterEach(() => {
  setBotEmbeds(true);
  setReduceMotion(false);
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('field rows', () => {
  test('inline fields share rows of three (two beside a thumbnail); others take a row each', () => {
    const f = (inline: boolean, name: string) => ({ name, value: 'v', inline });
    const names = (rows: { name: string }[][]) => rows.map((r) => r.map((x) => x.name).join(''));
    const fields = [f(true, 'a'), f(true, 'b'), f(true, 'c'), f(true, 'd'), f(false, 'e'), f(true, 'f')];
    expect(names(fieldRows(fields, false))).toEqual(['abc', 'd', 'e', 'f']);
    expect(names(fieldRows(fields, true))).toEqual(['ab', 'cd', 'e', 'f']);
    expect(fieldRows([], false)).toEqual([]);
  });
});

describe('embed card', () => {
  test('author, title through the link guard, markdown description with pills, fields and footer', async () => {
    await card([
      {
        type: 'rich',
        author: { name: 'Build bot', url: 'https://ci.example/bot' },
        title: 'Deploy **finished**',
        url: 'https://ci.example/run/7',
        description: 'Shipped by <@100> in **2 min**',
        fields: [
          { name: 'Branch', value: '`main`', inline: true },
          { name: 'Commit', value: 'abc123', inline: true },
        ],
        footer: { text: 'CI' },
        timestamp: '2026-10-10T12:00:00Z',
      },
    ]);
    expect(screen.getByText('Build bot')).toBeTruthy();
    expect(screen.getByText('finished')).toBeTruthy();
    expect(screen.getByText('2 min')).toBeTruthy();
    // A mention renders as the person's pill (rendering it notifies nobody).
    expect(screen.getByLabelText('@Me')).toBeTruthy();
    expect(screen.getByText('Branch')).toBeTruthy();
    expect(screen.getByText('abc123')).toBeTruthy();
    expect(screen.getByText(/^CI • /)).toBeTruthy();
    await fireEvent.press(screen.getByText('finished'));
    expect(externalLink.requestOpenExternalLink).toHaveBeenCalledWith('https://ci.example/run/7');
    await fireEvent.press(screen.getByText('Build bot'));
    expect(externalLink.requestOpenExternalLink).toHaveBeenCalledWith('https://ci.example/bot');
  });

  test('a title is styling only, and a link in the text carries no inline media or invite card', async () => {
    await card([{ title: '[not](https://x.example) a link <@100>', description: 'see https://media.example/cat.gif' }]);
    expect(screen.getByText(/\[not\]\(https:\/\/x\.example\) a link <@100>/)).toBeTruthy();
    expect(screen.getByText('https://media.example/cat.gif')).toBeTruthy();
    expect(screen.queryByTestId('img:https://media.example/cat.gif')).toBeNull();
  });

  test('an embed with nothing to show renders nothing', async () => {
    await card([{ color: 0xff0000 }]);
    expect(screen.toJSON()).toBeNull();
  });
});

describe('embed pictures', () => {
  test('pictures load from the proxy (a relative one against the API) or the instance CDN, never the source', async () => {
    const own = `${cdnUrl()}/attachments/1/chart.png`;
    await card([
      {
        title: 'Pictures',
        image: { url: 'https://img.example/big.png', proxy_url: '/media/v1/external/sig/src', width: 800, height: 400 },
        thumbnail: { url: own, proxy_url: own },
        author: { name: 'Bot', icon_url: 'https://img.example/icon.png', proxy_icon_url: 'https://chat.example/api/media/v1/external/s2/i2' },
      },
    ]);
    expect(screen.getByTestId(`img:${apiUrl()}/media/v1/external/sig/src`)).toBeTruthy();
    expect(screen.getByTestId(`img:${own}`)).toBeTruthy();
    expect(screen.getByTestId('img:https://chat.example/api/media/v1/external/s2/i2')).toBeTruthy();
    expect(screen.queryByTestId('img:https://img.example/big.png')).toBeNull();
    expect(screen.queryByTestId('img:https://img.example/icon.png')).toBeNull();
  });

  test('without a proxied copy the picture waits behind a placeholder that names the site and the cost', async () => {
    await card([{ title: 'Unproxied', image: { url: 'https://img.example/big.png' }, footer: { text: 'f', icon_url: 'https://img.example/f.png' } }]);
    expect(screen.queryByTestId('img:https://img.example/big.png')).toBeNull();
    // An icon with no copy is simply left out.
    expect(screen.queryByTestId('img:https://img.example/f.png')).toBeNull();
    expect(screen.getByText('Image from img.example')).toBeTruthy();
    expect(screen.getByText('Loading it shows your IP address to that site.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Load image'));
    expect(screen.getByTestId('img:https://img.example/big.png')).toBeTruthy();
  });

  test('a picture that may animate is held still for a reader who asked for reduced motion', async () => {
    const gif = { url: 'https://img.example/party.gif', proxy_url: 'https://chat.example/api/media/v1/external/g/p' };
    await card([{ title: 'GIF', image: gif }]);
    expect(screen.getByTestId(`img:${gif.proxy_url}`).props.autoplay).toBe(true);
    await act(async () => {
      setReduceMotion(true);
    });
    expect(screen.getByTestId(`img:${gif.proxy_url}`).props.autoplay).toBe(false);
  });

  test('under reduced motion every picture and icon is held still whatever its URL says; the GIF badge only on a .gif', async () => {
    // The proxy serves the bytes it finds: an extensionless URL can be an animated GIF.
    const anim = { url: 'https://img.example/anim', proxy_url: 'https://chat.example/api/media/v1/external/a/anim' };
    const gif = { url: 'https://img.example/party.gif', proxy_url: 'https://chat.example/api/media/v1/external/g/p' };
    const icon = 'https://chat.example/api/media/v1/external/i/icon';
    await act(async () => {
      setReduceMotion(true);
    });
    await card([
      { title: 'No extension', image: anim, author: { name: 'Bot', icon_url: 'https://img.example/icon', proxy_icon_url: icon } },
      { title: 'Named', image: gif },
    ]);
    expect(screen.getByTestId(`img:${anim.proxy_url}`).props.autoplay).toBe(false);
    expect(screen.getByTestId(`img:${gif.proxy_url}`).props.autoplay).toBe(false);
    expect(screen.getByTestId(`img:${icon}`).props.autoplay).toBe(false);
    for (const src of [anim.proxy_url, gif.proxy_url]) {
      await fireEvent(screen.getByTestId(`img:${src}`), 'load', { source: { width: 200, height: 100 } });
    }
    expect(screen.getAllByText('GIF')).toHaveLength(1);
  });
});

describe('embeds in a message row', () => {
  const own = () => `${cdnUrl()}/attachments/5/report.png`;
  function seed() {
    setMessages('byRoom', 'r', [
      message('r', '1', '7', {
        plaintext: 'Report: https://ci.example/run/7',
        notEncrypted: true,
        attachments: [
          { id: 'a1', filename: 'report.png', url: own(), content_type: 'image/png', size: 10 },
          { id: 'a2', filename: 'log.txt', url: `${cdnUrl()}/attachments/5/log.txt`, content_type: 'text/plain', size: 10 },
        ],
        embeds: [{ type: 'rich', title: 'Nightly report', url: 'https://ci.example/run/7', image: { url: own(), proxy_url: own() } }],
      } as never),
    ]);
  }

  test('the card shows under the files, the picture it carries is not repeated, and its link gets no preview', async () => {
    seed();
    await row('1');
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Nightly report')).toBeTruthy();
    expect(screen.getByText('log.txt')).toBeTruthy();
    expect(screen.queryByLabelText('report.png')).toBeNull();
    expect(mockUnfurl).not.toHaveBeenCalled();
  });

  test('on a mirror the picture is not repeated either: its attachment is on the origin\'s CDN', async () => {
    const origin = 'https://origin.example/cdn/attachments/5';
    setMessages('byRoom', 'r', [
      message('r', '2', '7', {
        plaintext: 'Chart attached',
        notEncrypted: true,
        attachments: [
          { id: 'a1', filename: 'chart.png', url: `${origin}/chart.png`, content_type: 'image/png', size: 10 },
          { id: 'a2', filename: 'notes.txt', url: `${origin}/notes.txt`, content_type: 'text/plain', size: 10 },
        ],
        embeds: [{ type: 'rich', title: 'Weekly chart', image: { url: `${origin}/chart.png`, proxy_url: 'https://chat.example/api/media/v1/external/c/chart' } }],
      } as never),
    ]);
    await row('2');
    expect(screen.getByText('Weekly chart')).toBeTruthy();
    expect(screen.getByText('notes.txt')).toBeTruthy();
    expect(screen.queryByLabelText('chart.png')).toBeNull();
  });

  test('a link written differently from the embed\'s url is still its link: no preview card for it', async () => {
    setMessages('byRoom', 'r', [
      message('r', '3', '7', {
        plaintext: 'see https://CI.example and https://docs.example/page',
        notEncrypted: true,
        embeds: [{ type: 'rich', title: 'CI', url: 'https://CI.example' }],
      } as never),
    ]);
    await row('3');
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockUnfurl).toHaveBeenCalledWith('https://docs.example/page');
    expect(mockUnfurl).not.toHaveBeenCalledWith('https://CI.example');
  });

  test('where embeds are off the card is gone and every file shows', async () => {
    seed();
    await row('1', { showEmbeds: false });
    expect(screen.queryByText('Nightly report')).toBeNull();
    expect(screen.getByLabelText('report.png')).toBeTruthy();
  });
});

describe('the shared rules (lib/embeds/messageEmbeds)', () => {
  test('an embedded picture is matched against the message\'s own attachments wherever they live', () => {
    const files = [{ url: 'https://origin.example/cdn/attachments/5/a.png?ex=1' }, { url: 'https://origin.example/cdn/attachments/5/b.txt' }];
    expect(attachmentsBesideEmbeds(files, [{ image: { url: 'https://origin.example/cdn/attachments/5/a.png' } }])).toEqual([files[1]]);
    expect(attachmentsBesideEmbeds(files, [{ footer: { text: 'f', icon_url: 'https://origin.example/cdn/attachments/5/b.txt' } }])).toEqual([files[0]]);
    // Nothing left out: the same array, so a memo on it holds.
    expect(attachmentsBesideEmbeds(files, [{ image: { url: 'https://img.example/other.png' } }])).toBe(files);
  });

  test('preview links and embed links are compared normalized on both sides', () => {
    expect(previewUrlsBesideEmbeds(['https://Example.com', 'https://other.example/x'], ['https://example.com/'])).toEqual(['https://other.example/x']);
    expect(previewUrlsBesideEmbeds(['https://example.com/'], ['https://EXAMPLE.com'])).toEqual([]);
    const urls = ['https://a.example/'];
    expect(previewUrlsBesideEmbeds(urls, undefined)).toBe(urls);
    expect(previewUrlsBesideEmbeds(urls, ['not a url'])).toBe(urls);
  });
});

describe('which rooms show embeds', () => {
  test('plain rooms only, and only while the reader keeps them on', async () => {
    setRooms({
      rooms: [pm('plain', user('7'), { e2ee_enabled: false }), pm('secret', user('7'), { e2ee_enabled: true }), pm('unsaid', user('7'))],
    });
    setSpaces('spaceRoomsBySpaceId', { s1: [sroom('open', 3), sroom('locked', 3, { e2ee_enabled: true })] });
    expect(embedsShown('plain')).toBe(true);
    expect(embedsShown('secret')).toBe(false);
    expect(embedsShown('unsaid')).toBe(false);
    expect(embedsShown('open')).toBe(true);
    expect(embedsShown('locked')).toBe(false);
    expect(embedsShown('nowhere')).toBe(false);
    setBotEmbeds(false);
    expect(embedsShown('plain')).toBe(false);
    expect(embedsShown('open')).toBe(false);
  });
});
