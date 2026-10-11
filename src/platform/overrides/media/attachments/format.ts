/**
 * Mobile replacement for web/src/lib/attachments/format.ts: the web's helpers (limits, kinds,
 * voice-message naming, file icons, sizing) re-exported unchanged, and `readImageDimensions`
 * rebuilt for files. The web decodes a Blob through an object URL and an <img>; here the
 * native image loader reads the header of a local file (React Native's Image.getSize).
 */
import { Image } from 'react-native';

export * from '@web-original/lib/attachments/format';

/** Natural dimensions of an image file, or null if it can't be decoded. */
export async function readImageDimensions(file: { uri: string } | string): Promise<{ width: number; height: number } | null> {
  const uri = typeof file === 'string' ? file : file.uri;
  try {
    const { width, height } = await Image.getSize(uri);
    return width > 0 && height > 0 ? { width, height } : null;
  } catch {
    return null;
  }
}
