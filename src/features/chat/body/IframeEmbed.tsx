/**
 * Click-to-load player for an embeddable provider (YouTube via youtube-nocookie, Vimeo,
 * Dailymotion, Loom, Streamable, Twitch). Until play is pressed it is only the poster with a
 * play badge and the provider's name - nothing is requested from the provider, so a screen of
 * cards does not phone home, as on the web. Play mounts a WebView holding the provider's
 * iframe, served from the instance's web origin so YouTube gets the referrer it requires and
 * Twitch's `parent` matches.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { WebView } from 'react-native-webview';
import { t } from '@web/i18n/t';
import type { VideoEmbed } from '@web/lib/embeds/providers';
import { HorizontalGestureOwner } from '@/shell/SwipeShell';
import { useTheme } from '@/theme';
import { Icon, onScrim, Text, Touchable } from '@/ui';

const PORTRAIT_W = 236;

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** The document the WebView loads: the provider's iframe filling the frame, nothing else. */
export function embedHtml(embed: VideoEmbed, title: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="${escapeAttr(
    embed.src,
  )}" title="${escapeAttr(title)}" allow="${escapeAttr(embed.allow)}" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;
}

export function IframeEmbed({ embed, poster, title, maxWidth }: { embed: VideoEmbed; poster?: string; title?: string; maxWidth: number }) {
  const theme = useTheme();
  const [active, setActive] = useState(false);
  const width = Math.min(embed.portrait ? PORTRAIT_W : 400, maxWidth);
  const height = Math.round(embed.portrait ? (width * 16) / 9 : (width * 9) / 16);
  const label = `${t('attachments.player.play')} · ${embed.provider}`;
  const scrimText = onScrim(theme);
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined;

  return (
    <View style={[styles.frame, { width, height, borderRadius: theme.radii.sm }]}>
      {active ? (
        <HorizontalGestureOwner>
          <WebView
            style={styles.web}
            source={{ html: embedHtml(embed, title || embed.provider), ...(origin ? { baseUrl: origin } : {}) }}
            originWhitelist={['*']}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo
            javaScriptEnabled
            setSupportMultipleWindows={false}
            accessibilityLabel={title || embed.provider}
          />
        </HorizontalGestureOwner>
      ) : (
        <Touchable feedback="opacity" onPress={() => setActive(true)} accessibilityRole="button" accessibilityLabel={label} style={styles.fill}>
          {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={poster} /> : null}
          <View style={[StyleSheet.absoluteFill, styles.dim]} />
          <View style={styles.badge}>
            <Icon name="play" size={22} color={scrimText} style={styles.nudge} />
          </View>
          <View style={styles.provider}>
            <Text variant="caption" color={scrimText} weight="medium">
              {embed.provider}
            </Text>
          </View>
        </Touchable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { marginTop: 8, overflow: 'hidden', backgroundColor: '#000', maxWidth: '100%' },
  web: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { backgroundColor: 'rgba(0,0,0,0.25)' },
  badge: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  nudge: { marginStart: 3 },
  provider: { position: 'absolute', bottom: 6, end: 8, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
});
