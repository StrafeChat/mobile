/**
 * A QR code, drawn with react-native-svg from the encoder in ../qr.ts. Always dark modules on
 * a light card whatever the theme - scanners need that contrast (the web pins bg-white too).
 */
import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { encodeQr, qrPath, type QrEcc } from '../qr';

/** Scanner contrast, not theme colours: a QR code is black on white everywhere. */
const QR_DARK = '#000000';
const QR_LIGHT = '#ffffff';
const MARGIN = 2;

export function QrCode({ value, size = 220, ecc = 'M', accessibilityLabel }: { value: string; size?: number; ecc?: QrEcc; accessibilityLabel?: string }) {
  const encoded = useMemo(() => {
    try {
      const m = encodeQr(value, ecc);
      return { path: qrPath(m, MARGIN), extent: m.size + MARGIN * 2 };
    } catch {
      return null;
    }
  }, [value, ecc]);
  if (!encoded) return null;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{ width: size, height: size, borderRadius: 12, overflow: 'hidden', backgroundColor: QR_LIGHT }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${encoded.extent} ${encoded.extent}`}>
        <Rect x={0} y={0} width={encoded.extent} height={encoded.extent} fill={QR_LIGHT} />
        <Path d={encoded.path} fill={QR_DARK} />
      </Svg>
    </View>
  );
}
