/**
 * Where a photo or video was taken, removed from the file before it leaves the device.
 *
 * On Android the image picker hands over the camera app's own file byte for byte (quality 1),
 * and even when it re-encodes or crops it copies the EXIF tags across - GPS included. A camera
 * app with location tagging on (Samsung's "Location tags", Google Camera's "Save location")
 * therefore puts the coordinates into every photo taken from the composer or for an avatar or
 * banner, and the server stores the bytes as they are, behind a public URL. The Android photo
 * picker withholds location from an app without ACCESS_MEDIA_LOCATION, but the camera and the
 * older pickers do not. On iOS photos are re-encoded without their metadata (pickers.ts), but
 * videos are not: a recording from the library or the camera keeps the place it was made.
 *
 * So the file is edited in place, without re-encoding and without moving a single byte:
 *
 * - JPEG: the EXIF GPS directory is emptied (its entries and their values zeroed), which keeps
 *   every other tag - the orientation above all, or the photo would show sideways. An XMP
 *   packet that mentions GPS is blanked whole.
 * - MP4 / QuickTime (videos): the location boxes (`©xyz`, written by Android's MediaMuxer, and
 *   the 3GPP `loci`) become `free` boxes with their contents zeroed, which every player skips.
 *   So do the items of QuickTime's keyed metadata (iPhone recordings) whose key names a
 *   location - `com.apple.quicktime.location.ISO6709` and its companions (accuracy, name...).
 *   The key names stay, without values; the other keys keep theirs.
 *
 * Anything the parser does not recognise is left alone; a write that fails throws, and the
 * picker then refuses the file rather than send it unchecked.
 */
import { File, FileMode } from 'expo-file-system';

/** Reads and writes at absolute offsets: a file handle on a device, a byte array in tests. */
export interface RandomAccess {
  readonly size: number;
  /** Up to `length` bytes at `offset` (fewer at the end of the file). */
  read(offset: number, length: number): Uint8Array;
  write(offset: number, bytes: Uint8Array): void;
}

// ---- JPEG --------------------------------------------------------------------------------------

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP_NAMESPACES = ['http://ns.adobe.com/xap/1.0/\0', 'http://ns.adobe.com/xmp/extension/\0'];
const GPS_IFD_POINTER = 0x8825;
/** Bytes per value of each TIFF field type (1 BYTE ... 13 IFD). */
const TIFF_TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

function startsWith(buf: Uint8Array, prefix: readonly number[], at = 0): boolean {
  if (buf.length < at + prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (buf[at + i] !== prefix[i]) return false;
  return true;
}

function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

/**
 * Empty the GPS directory of the TIFF structure inside an APP1 "Exif" payload, in place.
 * True when there was something to remove.
 */
export function scrubExifGps(buf: Uint8Array): boolean {
  const t = EXIF_HEADER.length;
  if (!startsWith(buf, EXIF_HEADER) || buf.length < t + 8) return false;
  const little = buf[t] === 0x49 && buf[t + 1] === 0x49;
  const big = buf[t] === 0x4d && buf[t + 1] === 0x4d;
  if (!little && !big) return false;
  const u16 = (o: number) => (little ? buf[o]! | (buf[o + 1]! << 8) : (buf[o]! << 8) | buf[o + 1]!);
  const u32 = (o: number) =>
    (little ? buf[o]! | (buf[o + 1]! << 8) | (buf[o + 2]! << 16) | (buf[o + 3]! << 24) : (buf[o]! << 24) | (buf[o + 1]! << 16) | (buf[o + 2]! << 8) | buf[o + 3]!) >>> 0;
  if (u16(t + 2) !== 42) return false;

  // The GPS pointer lives in IFD0 (the main image's directory).
  const ifd0 = t + u32(t + 4);
  if (ifd0 + 2 > buf.length) return false;
  const count0 = u16(ifd0);
  if (ifd0 + 2 + count0 * 12 > buf.length) return false;
  let gps = -1;
  for (let i = 0; i < count0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) === GPS_IFD_POINTER) gps = t + u32(e + 8);
  }
  if (gps < 0 || gps + 2 > buf.length) return false;
  const count = u16(gps);
  if (count === 0) return false;
  const entriesEnd = Math.min(buf.length, gps + 2 + count * 12);

  for (let i = 0; i < count; i++) {
    const e = gps + 2 + i * 12;
    if (e + 12 > buf.length) break;
    const size = (TIFF_TYPE_SIZES[u16(e + 2)] ?? 0) * u32(e + 4);
    // A value over four bytes lives elsewhere in the payload, pointed at by the entry.
    if (size > 4) {
      const at = t + u32(e + 8);
      if (at >= t && at + size <= buf.length) buf.fill(0, at, at + size);
    }
  }
  // No entries, and (being zeroed) no pointer to a next directory.
  buf.fill(0, gps, Math.min(buf.length, entriesEnd + 4));
  return true;
}

function containsGps(buf: Uint8Array, from: number): boolean {
  // "gps", any case: exif:GPSLatitude, drone-dji:GpsLatitude...
  for (let i = from; i + 2 < buf.length; i++) {
    if ((buf[i]! | 0x20) === 0x67 && (buf[i + 1]! | 0x20) === 0x70 && (buf[i + 2]! | 0x20) === 0x73) return true;
  }
  return false;
}

/** One APP1 payload: EXIF loses its GPS directory, an XMP packet that mentions GPS is blanked. */
function scrubApp1(buf: Uint8Array): boolean {
  if (startsWith(buf, EXIF_HEADER)) return scrubExifGps(buf);
  for (const ns of XMP_NAMESPACES) {
    const prefix = ascii(ns);
    if (!startsWith(buf, prefix)) continue;
    if (!containsGps(buf, prefix.length)) return false;
    // Spaces are what an XMP packet pads itself with; a reader finds no packet and moves on.
    buf.fill(0x20, prefix.length);
    return true;
  }
  return false;
}

/** Scrub a JPEG's metadata segments (everything before the image data). True if it changed. */
export function scrubJpeg(io: RandomAccess): boolean {
  const soi = io.read(0, 2);
  if (soi[0] !== 0xff || soi[1] !== 0xd8) return false;
  let pos = 2;
  let changed = false;
  while (pos + 4 <= io.size) {
    const h = io.read(pos, 4);
    if (h.length < 4 || h[0] !== 0xff) break;
    const marker = h[1]!;
    if (marker === 0xff) {
      pos += 1; // fill byte before a marker
      continue;
    }
    // Start of scan (the image data follows) or end of image: the metadata is all behind us.
    if (marker === 0xda || marker === 0xd9) break;
    // Markers that stand alone, without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2;
      continue;
    }
    const length = (h[2]! << 8) | h[3]!;
    if (length < 2 || pos + 2 + length > io.size) break;
    if (marker === 0xe1) {
      const payload = io.read(pos + 4, length - 2);
      if (payload.length === length - 2 && scrubApp1(payload)) {
        io.write(pos + 4, payload);
        changed = true;
      }
    }
    pos += 2 + length;
  }
  return changed;
}

// ---- MP4 / QuickTime -----------------------------------------------------------------------------

/** `©xyz` (0xA9 'x' 'y' 'z') and the 3GPP location box. */
const LOCATION_BOXES = new Set(['©xyz', 'loci']);
/** The `keys` namespace whose key is a user-data box type (`©xyz`) rather than a name. */
const UDTA_NAMESPACE = 'udta';
/** Boxes the location boxes can sit in, under `moov`. */
const CONTAINER_BOXES = new Set(['trak', 'udta', 'meta', 'ilst']);
/** A `moov` larger than this is not read into memory (it would be a very unusual file). */
const MOOV_MAX_BYTES = 64 * 1024 * 1024;
const FREE = ascii('free');

function u32be(buf: Uint8Array, o: number): number {
  return ((buf[o]! << 24) | (buf[o + 1]! << 16) | (buf[o + 2]! << 8) | buf[o + 3]!) >>> 0;
}

function fourcc(buf: Uint8Array, o: number): string {
  return String.fromCharCode(buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!);
}

/**
 * The box whose header starts at `at` in `buf`, `remaining` bytes from the end of its parent
 * (or of the file): its type, its size and its header's length, or null when it is not one.
 */
function boxAt(buf: Uint8Array, at: number, remaining: number): { type: string; size: number; header: number } | null {
  if (remaining < 8 || at + 8 > buf.length) return null;
  let size = u32be(buf, at);
  let header = 8;
  if (size === 1) {
    if (remaining < 16 || at + 16 > buf.length) return null;
    size = u32be(buf, at + 8) * 2 ** 32 + u32be(buf, at + 12);
    header = 16;
  } else if (size === 0) {
    size = remaining; // to the end
  }
  if (size < header || size > remaining) return null;
  return { type: fourcc(buf, at + 4), size, header };
}

/** Turn the box at `at` into a `free` box of the same size with nothing in it. */
function freeBox(buf: Uint8Array, at: number, box: { size: number; header: number }): void {
  buf.set(FREE, at + 4);
  buf.fill(0, at + box.header, at + box.size);
}

const LOCATION_WORD = ascii('location');

/** Whether `buf[from..to]` contains "location", in any case (the key names are ASCII). */
function containsLocation(buf: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i + LOCATION_WORD.length <= to; i++) {
    let j = 0;
    while (j < LOCATION_WORD.length && (buf[i + j]! | 0x20) === LOCATION_WORD[j]) j++;
    if (j === LOCATION_WORD.length) return true;
  }
  return false;
}

/**
 * The 1-based indexes of the location keys in the `keys` box among a QuickTime `meta`'s
 * children (`start`..`end`). Each entry is its size (header included), a namespace and the
 * key: a name in the 'mdta' namespace (com.apple.quicktime.location.ISO6709,
 * ...location.accuracy.horizontal), or in the 'udta' one a user-data box type such as `©xyz`.
 */
function locationKeyIndexes(buf: Uint8Array, start: number, end: number): Set<number> {
  const found = new Set<number>();
  let pos = start;
  while (pos < end) {
    const box = boxAt(buf, pos, end - pos);
    if (!box) break;
    const boxEnd = pos + box.size;
    if (box.type === 'keys' && box.size >= box.header + 8) {
      // Version and flags, the entry count, then the entries.
      const count = u32be(buf, pos + box.header + 4);
      let at = pos + box.header + 8;
      for (let i = 1; i <= count && at + 8 <= boxEnd; i++) {
        const size = u32be(buf, at);
        if (size < 8 || at + size > boxEnd) break;
        const udtaBox = fourcc(buf, at + 4) === UDTA_NAMESPACE && size === 12 && LOCATION_BOXES.has(fourcc(buf, at + 8));
        if (udtaBox || containsLocation(buf, at + 8, at + size)) found.add(i);
        at += size;
      }
    }
    pos = boxEnd;
  }
  return found;
}

/**
 * Free the items of a keyed `ilst` among a `meta`'s children whose key is a location: in keyed
 * metadata an item's box type is not a name but the index of its key, as a 32-bit number.
 */
function scrubKeyedItems(buf: Uint8Array, start: number, end: number, keys: ReadonlySet<number>): boolean {
  let changed = false;
  let pos = start;
  while (pos < end) {
    const box = boxAt(buf, pos, end - pos);
    if (!box) break;
    if (box.type === 'ilst') {
      const listEnd = pos + box.size;
      let item = pos + box.header;
      while (item < listEnd) {
        const entry = boxAt(buf, item, listEnd - item);
        if (!entry) break;
        if (keys.has(u32be(buf, item + 4))) {
          freeBox(buf, item, entry);
          changed = true;
        }
        item += entry.size;
      }
    }
    pos += box.size;
  }
  return changed;
}

function scrubBoxes(buf: Uint8Array, start: number, end: number, depth: number): boolean {
  let changed = false;
  let pos = start;
  while (pos < end) {
    const box = boxAt(buf, pos, end - pos);
    if (!box) break;
    if (LOCATION_BOXES.has(box.type)) {
      freeBox(buf, pos, box);
      changed = true;
    } else if (CONTAINER_BOXES.has(box.type) && depth < 8) {
      let children = pos + box.header;
      // ISO 'meta' is a full box (four bytes of version and flags before its children);
      // QuickTime's is not. A zero there cannot be a child box's size.
      if (box.type === 'meta' && children + 4 <= pos + box.size && u32be(buf, children) === 0) children += 4;
      if (box.type === 'meta') {
        // QuickTime's keyed metadata (an 'mdta' handler): a `keys` box names each key once,
        // and the `ilst` beside it holds the values, each under its key's index.
        const keys = locationKeyIndexes(buf, children, pos + box.size);
        if (keys.size > 0 && scrubKeyedItems(buf, children, pos + box.size, keys)) changed = true;
      }
      if (scrubBoxes(buf, children, pos + box.size, depth + 1)) changed = true;
    }
    pos += box.size;
  }
  return changed;
}

/** Scrub an MP4 / QuickTime file's `moov` of location boxes. True if it changed. */
export function scrubMp4(io: RandomAccess): boolean {
  let changed = false;
  let pos = 0;
  // Only the top-level headers are read on the way (the media data can be gigabytes).
  while (pos + 8 <= io.size) {
    const box = boxAt(io.read(pos, 16), 0, io.size - pos);
    if (!box) break;
    if (box.type === 'moov' && box.size <= MOOV_MAX_BYTES) {
      const moov = io.read(pos, box.size);
      if (moov.length === box.size && scrubBoxes(moov, box.header, box.size, 0)) {
        io.write(pos, moov);
        changed = true;
      }
    }
    pos += box.size;
  }
  return changed;
}

// ---- files ---------------------------------------------------------------------------------------

function isJpeg(head: Uint8Array): boolean {
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

function isIsoMedia(head: Uint8Array): boolean {
  return head.length >= 8 && fourcc(head, 4) === 'ftyp';
}

/**
 * Remove location metadata from a picked or captured file in place (see the top of the file).
 * True when something was removed. Throws when the file cannot be read or written.
 */
export function stripLocation(uri: string): boolean {
  const handle = new File(uri).open(FileMode.ReadWrite);
  try {
    const size = handle.size ?? 0;
    const io: RandomAccess = {
      size,
      read(offset, length) {
        handle.offset = offset;
        return handle.readBytes(Math.max(0, Math.min(length, size - offset)));
      },
      write(offset, bytes) {
        handle.offset = offset;
        handle.writeBytes(bytes);
      },
    };
    const head = io.read(0, 12);
    if (isJpeg(head)) return scrubJpeg(io);
    if (isIsoMedia(head)) return scrubMp4(io);
    return false;
  } finally {
    handle.close();
  }
}
