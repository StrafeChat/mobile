/**
 * Location metadata out of camera photos and videos, in place: a JPEG's EXIF GPS directory is
 * emptied with every other tag (the orientation) kept, an XMP packet that mentions GPS is
 * blanked, an MP4's location boxes - and the location items of an iPhone recording's keyed
 * QuickTime metadata - become zeroed `free` boxes, and nothing else in the file moves or
 * changes.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-file-system', () => require('./testing/memoryFileSystem'));

const { scrubJpeg, scrubMp4, stripLocation } = require('./stripLocation') as typeof import('./stripLocation');
const { memoryFs } = require('./testing/memoryFileSystem') as typeof import('./testing/memoryFileSystem');

function bytesIo(buf: Uint8Array) {
  return {
    size: buf.length,
    read: (offset: number, length: number) => buf.slice(offset, Math.min(buf.length, offset + length)),
    write: (offset: number, bytes: Uint8Array) => buf.set(bytes, offset),
  };
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
/** One character per byte (expo's TextDecoder knows only UTF-8). */
const latin1 = (b: Uint8Array) => String.fromCharCode(...b);
const concat = (...parts: (number[] | Uint8Array)[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));

// ---- a camera JPEG -------------------------------------------------------------------------

/**
 * "Exif\0\0" + a TIFF structure: IFD0 holds the orientation (rotate 90) and the GPS pointer; the
 * GPS directory holds N 51° 30' and its reference, the degrees as three rationals stored after
 * the directories.
 */
function exifPayload(little: boolean) {
  const out: number[] = [];
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  const entry = (tag: number, type: number, count: number, value: number[]) => [...u16(tag), ...u16(type), ...u32(count), ...value, ...Array(4 - value.length).fill(0)];
  // TIFF offsets count from the byte order mark.
  const ifd0 = 8;
  const gpsIfd = ifd0 + 2 + 2 * 12 + 4; // 38
  const latData = gpsIfd + 2 + 2 * 12 + 4; // 68
  out.push(...(little ? ascii('II') : ascii('MM')), ...u16(42), ...u32(ifd0));
  out.push(...u16(2), ...entry(0x0112, 3, 1, u16(6)), ...entry(0x8825, 4, 1, u32(gpsIfd)), ...u32(0));
  out.push(...u16(2), ...entry(0x0001, 2, 2, ascii('N\0')), ...entry(0x0002, 5, 3, u32(latData)), ...u32(0));
  out.push(...u32(51), ...u32(1), ...u32(30), ...u32(1), ...u32(15), ...u32(1));
  return { payload: concat(ascii('Exif\0\0'), out), tiff: 6, gpsIfd, latData, ifd0 };
}

function segment(marker: number, payload: Uint8Array | number[]) {
  const len = payload.length + 2;
  return concat([0xff, marker, len >> 8, len & 0xff], payload);
}

function jpeg(...segments: Uint8Array[]) {
  // SOI, the segments, a quantisation table, start of scan, two bytes of "image data", EOI.
  return concat([0xff, 0xd8], ...segments, segment(0xdb, Array(5).fill(7)), segment(0xda, [1, 2, 3]), [0x12, 0x34, 0xff, 0xd9]);
}

describe('JPEG', () => {
  it.each([true, false])('empties the GPS directory and keeps the orientation (little-endian: %s)', (little) => {
    const exif = exifPayload(little);
    const file = jpeg(segment(0xe1, exif.payload));
    const before = file.slice();
    expect(scrubJpeg(bytesIo(file))).toBe(true);
    expect(file.length).toBe(before.length);

    const at = 6 + exif.tiff; // SOI (2) + marker and length (4)
    const changed: number[] = [];
    for (let i = 0; i < file.length; i++) if (file[i] !== before[i]) changed.push(i - at);
    // Only the GPS directory (count, entries, next pointer) and the latitude it pointed at.
    const gpsEnd = exif.gpsIfd + 2 + 2 * 12 + 4;
    expect(changed.every((o) => (o >= exif.gpsIfd && o < gpsEnd) || (o >= exif.latData && o < exif.latData + 24))).toBe(true);
    expect(file.slice(at + exif.latData, at + exif.latData + 24).every((b) => b === 0)).toBe(true);
    expect(file.slice(at + exif.gpsIfd, at + gpsEnd).every((b) => b === 0)).toBe(true);
    // IFD0, with the orientation, is untouched.
    expect(Array.from(file.slice(at + exif.ifd0, at + exif.gpsIfd))).toEqual(Array.from(before.slice(at + exif.ifd0, at + exif.gpsIfd)));
    // Nothing to do the second time.
    expect(scrubJpeg(bytesIo(file))).toBe(false);
  });

  it('leaves a photo without GPS alone', () => {
    const exif = exifPayload(true).payload;
    // Turn the GPS pointer into an unrelated tag.
    const noGps = exif.slice();
    noGps[6 + 8 + 2 + 12] = 0x10;
    noGps[6 + 8 + 2 + 12 + 1] = 0x01;
    const file = jpeg(segment(0xe1, noGps));
    const before = file.slice();
    expect(scrubJpeg(bytesIo(file))).toBe(false);
    expect(file).toEqual(before);
  });

  it('blanks an XMP packet that carries GPS, and only that one', () => {
    const ns = ascii('http://ns.adobe.com/xap/1.0/\0');
    const withGps = concat(ns, ascii('<x:xmpmeta><rdf:Description exif:GPSLatitude="51,30.25N"/></x:xmpmeta>'));
    const plain = concat(ns, ascii('<x:xmpmeta><rdf:Description xmp:Rating="5"/></x:xmpmeta>'));
    const file = jpeg(segment(0xe1, withGps), segment(0xe1, plain));
    const before = file.slice();
    expect(scrubJpeg(bytesIo(file))).toBe(true);
    const text = latin1(file);
    expect(text).not.toMatch(/GPS|51,30/);
    expect(text).toContain('http://ns.adobe.com/xap/1.0/');
    expect(text).toContain('xmp:Rating="5"');
    expect(file.length).toBe(before.length);
  });

  it('stops at the image data: nothing after the start of scan is read as metadata', () => {
    const exif = exifPayload(true).payload;
    // An APP1-looking run inside the scan is image data, not a segment.
    const file = concat([0xff, 0xd8], segment(0xda, [1, 2, 3]), segment(0xe1, exif), [0xff, 0xd9]);
    const before = file.slice();
    expect(scrubJpeg(bytesIo(file))).toBe(false);
    expect(file).toEqual(before);
  });

  it('ignores what is not a JPEG, and a segment that runs past the end', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(scrubJpeg(bytesIo(png))).toBe(false);
    const truncated = concat([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00], ascii('Exif\0\0'));
    expect(scrubJpeg(bytesIo(truncated))).toBe(false);
  });
});

// ---- a camera MP4 --------------------------------------------------------------------------

function box(type: string | number[], ...children: (number[] | Uint8Array)[]) {
  const body = concat(...children);
  const size = body.length + 8;
  return concat([size >>> 24, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff], typeof type === 'string' ? ascii(type) : type, body);
}

const XYZ = [0xa9, 0x78, 0x79, 0x7a]; // ©xyz

describe('MP4', () => {
  it('turns every location box under moov into a zeroed free box, sizes and all else unchanged', () => {
    const iso6709 = ascii('+51.5074-000.1278/');
    const file = concat(
      box('ftyp', ascii('mp42'), [0, 0, 0, 0], ascii('isommp42')),
      box('mdat', Array(32).fill(0x55)),
      box(
        'moov',
        box('mvhd', Array(20).fill(1)),
        box('udta', box(XYZ, [0, 18, 0x15, 0xc7], iso6709)),
        box('trak', box('tkhd', Array(12).fill(2)), box('udta', box('loci', Array(16).fill(9)))),
        // ISO meta: version and flags, then an iTunes-style item list.
        box('meta', [0, 0, 0, 0], box('hdlr', Array(8).fill(3)), box('ilst', box(XYZ, box('data', iso6709)))),
      ),
    );
    const before = file.slice();
    expect(scrubMp4(bytesIo(file))).toBe(true);
    expect(file.length).toBe(before.length);
    const text = latin1(file);
    expect(text).not.toContain('+51.5074');
    expect(text).not.toContain('©xyz');
    expect(text).not.toContain('loci');
    expect(text.match(/free/g)).toHaveLength(3);
    // The media data and the other boxes are byte for byte as they were.
    expect(text).toContain('mvhd');
    expect(Array.from(file.slice(0, 64))).toEqual(Array.from(before.slice(0, 64)));
    expect(scrubMp4(bytesIo(file))).toBe(false);
  });

  it('walks past a 64-bit media box to a moov at the end of the file', () => {
    const mdat = concat([0, 0, 0, 1], ascii('mdat'), [0, 0, 0, 0, 0, 0, 0, 24], Array(8).fill(0x55));
    const file = concat(box('ftyp', ascii('mp42')), mdat, box('moov', box('udta', box(XYZ, ascii('+10.0+020.0/')))));
    expect(scrubMp4(bytesIo(file))).toBe(true);
    expect(latin1(file)).not.toContain('+10.0');
  });

  it('stops at a box whose size does not fit, changing nothing', () => {
    const bad = concat(box('ftyp', ascii('mp42')), [0, 0, 1, 0], ascii('moov'), box('udta', box(XYZ, ascii('+1+2/'))));
    const before = bad.slice();
    expect(scrubMp4(bytesIo(bad))).toBe(false);
    expect(bad).toEqual(before);
  });
});

// ---- an iPhone recording: keyed QuickTime metadata ------------------------------------------------

const u32 = (v: number) => [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
/** A `keys` entry: its size, the namespace and the key. */
const key = (name: string | number[], namespace = 'mdta') => {
  const k = typeof name === 'string' ? ascii(name) : name;
  return concat(u32(k.length + 8), ascii(namespace), k);
};
/** An `ilst` item: a box typed with its key's 1-based index, holding one UTF-8 `data` value. */
const item = (index: number, value: string) => box(u32(index), box('data', [0, 0, 0, 1], [0, 0, 0, 0], ascii(value)));

const ISO6709 = '+51.5074-000.1278+011.000/';
const KEYS = [
  'com.apple.quicktime.make',
  'com.apple.quicktime.location.accuracy.horizontal',
  'com.apple.quicktime.model',
  'com.apple.quicktime.location.ISO6709',
  'com.apple.quicktime.software',
  'com.apple.quicktime.creationdate',
];

/** moov/meta as an iPhone writes it: no version and flags, an 'mdta' handler, keys, ilst. */
function keyedMeta(opts: { fullBox?: boolean; itemsFirst?: boolean } = {}) {
  const hdlr = box('hdlr', [0, 0, 0, 0], [0, 0, 0, 0], ascii('mdta'), Array(12).fill(0), [0]);
  const keys = box('keys', [0, 0, 0, 0], u32(KEYS.length), ...KEYS.map((k) => key(k)));
  const ilst = box(
    'ilst',
    item(1, 'Apple'),
    item(2, '4.712'),
    item(3, 'iPhone 17'),
    item(4, ISO6709),
    item(5, '26.0'),
    item(6, '2026-10-12T09:41:00+0100'),
  );
  return box('meta', ...(opts.fullBox ? [[0, 0, 0, 0]] : []), hdlr, ...(opts.itemsFirst ? [ilst, keys] : [keys, ilst]));
}

const movie = (...moov: Uint8Array[]) => concat(box('ftyp', ascii('qt  '), [0, 0, 0, 0], ascii('qt  ')), box('wide'), box('mdat', Array(32).fill(0x55)), box('moov', box('mvhd', Array(20).fill(1)), ...moov));

describe('QuickTime keyed metadata', () => {
  it.each([
    ['as an iPhone writes it', {}],
    ['in an ISO full-box meta (an exported MP4)', { fullBox: true }],
    ['with the items before the keys', { itemsFirst: true }],
  ])('frees the location items and keeps every other value (%s)', (_name, opts) => {
    const file = movie(keyedMeta(opts));
    const before = file.slice();
    expect(scrubMp4(bytesIo(file))).toBe(true);
    expect(file.length).toBe(before.length);
    const text = latin1(file);
    expect(text).not.toContain('+51.5074');
    expect(text).not.toContain('4.712');
    // The other values, and every key name, are where they were.
    for (const kept of ['Apple', 'iPhone 17', '26.0', '2026-10-12T09:41:00+0100', ...KEYS]) {
      expect(text.indexOf(kept)).toBe(latin1(before).indexOf(kept));
    }
    expect(text.match(/free/g)).toHaveLength(2);
    // Only the bytes of the two location items changed.
    const changed: number[] = [];
    for (let i = 0; i < file.length; i++) if (file[i] !== before[i]) changed.push(i);
    // An item is its header (8), the data box's header (8), type and locale (8), the value.
    const items = ['4.712', ISO6709].map((v) => [latin1(before).indexOf(v) - 24, latin1(before).indexOf(v) + v.length]);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((i) => items.some(([from, to]) => i >= from! && i < to!))).toBe(true);
    expect(scrubMp4(bytesIo(file))).toBe(false);
  });

  it('frees a track-level keyed list too, and a udta-namespace ©xyz key', () => {
    const keys = box('keys', [0, 0, 0, 0], u32(2), key('com.apple.quicktime.title'), key(XYZ, 'udta'));
    const meta = box('meta', box('hdlr', [0, 0, 0, 0], [0, 0, 0, 0], ascii('mdta'), Array(12).fill(0), [0]), keys, box('ilst', item(1, 'Holiday'), item(2, '+10.0+020.0/')));
    const file = movie(box('trak', box('tkhd', Array(12).fill(2)), meta));
    expect(scrubMp4(bytesIo(file))).toBe(true);
    const text = latin1(file);
    expect(text).not.toContain('+10.0');
    expect(text).toContain('Holiday');
  });

  it('leaves a recording without location keys alone', () => {
    const keys = box('keys', [0, 0, 0, 0], u32(1), key('com.apple.quicktime.make'));
    const file = movie(box('meta', keys, box('ilst', item(1, 'Apple'))));
    const before = file.slice();
    expect(scrubMp4(bytesIo(file))).toBe(false);
    expect(file).toEqual(before);
  });

  it('stops at a keys entry that runs past its box, keeping the keys before it', () => {
    // The second entry claims 4 KiB; the first (the location) still counts.
    const keys = box('keys', [0, 0, 0, 0], u32(2), key('com.apple.quicktime.location.ISO6709'), u32(4096), ascii('mdta'));
    const file = movie(box('meta', keys, box('ilst', item(1, ISO6709), item(2, 'kept'))));
    expect(scrubMp4(bytesIo(file))).toBe(true);
    const text = latin1(file);
    expect(text).not.toContain('+51.5074');
    expect(text).toContain('kept');
  });
});

// ---- the file on disk ------------------------------------------------------------------------

describe('stripLocation', () => {
  beforeEach(() => memoryFs.reset());

  it('edits a picked photo in place, and tells a video from a photo by its bytes', () => {
    const photo = memoryFs.put(`${memoryFs.cacheUri}/ImagePicker/a.jpg`, jpeg(segment(0xe1, exifPayload(true).payload)));
    expect(stripLocation(photo)).toBe(true);
    expect(stripLocation(photo)).toBe(false);
    const video = memoryFs.put(`${memoryFs.cacheUri}/ImagePicker/b.mp4`, concat(box('ftyp', ascii('mp42')), box('moov', box('udta', box(XYZ, ascii('+1+2/'))))));
    expect(stripLocation(video)).toBe(true);
    expect(latin1(memoryFs.read(video)!)).not.toContain('+1+2/');
    const iphone = memoryFs.put(`${memoryFs.cacheUri}/ImagePicker/c.mov`, movie(keyedMeta()));
    expect(stripLocation(iphone)).toBe(true);
    expect(latin1(memoryFs.read(iphone)!)).not.toContain('+51.5074');
    expect(stripLocation(iphone)).toBe(false);
  });

  it('leaves other files alone', () => {
    const doc = memoryFs.put(`${memoryFs.cacheUri}/ImagePicker/c.png`, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
    expect(stripLocation(doc)).toBe(false);
  });

  it('throws when the file is not there to check', () => {
    expect(() => stripLocation(`${memoryFs.cacheUri}/missing.jpg`)).toThrow();
  });
});
