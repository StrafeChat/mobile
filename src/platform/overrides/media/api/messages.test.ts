/**
 * uploadAttachment over React Native's XHR + FormData: the request the web sends, file parts
 * as {uri, name, type}, progress, ApiError on failure, cancellation, and the mobile cleanup.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { memoryFs } from '../../../media/testing/memoryFileSystem';
import { ApiError } from '@web/api/ApiError';
import { encryptAttachment } from '../attachments/crypto';
import { peekDecryptedAttachment } from '../../../media/attachmentCache';
import * as messages from './messages';

jest.mock('expo-file-system', () => require('../../../media/testing/memoryFileSystem'));
jest.mock('@web/api/client', () => ({
  ApiError: (jest.requireActual('@web/api/ApiError') as { ApiError: unknown }).ApiError,
  getApiUrl: () => 'https://chat.test/api',
  api: jest.fn(),
}));

type Part = [string, unknown];

class FakeFormData {
  parts: Part[] = [];
  append(name: string, value: unknown) {
    this.parts.push([name, value]);
  }
}

class FakeXHR {
  static last: FakeXHR | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: FakeFormData | null = null;
  status = 0;
  responseText = '';
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: FakeFormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.onload?.();
  }
}

const g = globalThis as unknown as Record<string, unknown>;
// Descriptors, not values: reading Node's own localStorage getter prints a warning.
const saved = ['XMLHttpRequest', 'FormData', 'localStorage'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);

beforeEach(() => {
  memoryFs.reset();
  FakeXHR.last = null;
  g.XMLHttpRequest = FakeXHR;
  g.FormData = FakeFormData;
  const store = new Map<string, string>([['session_token', 'tok-123']]);
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => store.get(k) ?? null },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  for (const [k, d] of saved) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete g[k];
  }
});

const photo = () => ({
  uri: memoryFs.put(`${memoryFs.cacheUri}/ImagePicker/p.jpg`, new Uint8Array([1, 2, 3])),
  name: 'p.jpg',
  type: 'image/jpeg',
  size: 3,
});

describe('uploadAttachment', () => {
  it('re-exports the rest of the web module', () => {
    for (const name of ['listMessages', 'getMessage', 'createMessage', 'editMessage', 'deleteMessage', 'addReaction', 'listPins']) {
      expect(typeof (messages as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('sends a plaintext file the way the web does', async () => {
    const progress: number[] = [];
    const p = messages.uploadAttachment('42', photo(), { filename: 'p.jpg', width: 640, height: 480, onProgress: (f) => progress.push(f) });
    const xhr = FakeXHR.last!;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('https://chat.test/api/rooms/42/attachments');
    expect(xhr.headers.Authorization).toBe('Bearer tok-123');
    expect(xhr.body!.parts).toEqual([
      ['file', { uri: photo().uri, name: 'p.jpg', type: 'image/jpeg' }],
      ['width', '640'],
      ['height', '480'],
    ]);
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 4 });
    xhr.upload.onprogress!({ lengthComputable: false, loaded: 2, total: 0 });
    xhr.respond(201, { id: '900', url: 'https://cdn.test/x/p.jpg', size: 3 });
    await expect(p).resolves.toEqual({ id: '900', url: 'https://cdn.test/x/p.jpg', size: 3 });
    expect(progress).toEqual([0.25]);
    // The user's file is never deleted by an upload.
    expect(memoryFs.exists(photo().uri)).toBe(true);
  });

  it('sends ciphertext as an anonymous blob, deletes it, and seeds the sender cache', async () => {
    const plain = photo();
    const { blob, material } = await encryptAttachment(plain);
    const p = messages.uploadAttachment('42', blob, { encrypted: true });
    const xhr = FakeXHR.last!;
    expect(xhr.body!.parts).toEqual([
      ['file', { uri: blob.uri, name: 'blob', type: 'application/octet-stream' }],
      ['encrypted', '1'],
    ]);
    xhr.respond(201, { id: '901', url: 'https://cdn.test/x/blob', size: 19, encrypted: true });
    await p;
    expect(memoryFs.exists(blob.uri)).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    const seeded = peekDecryptedAttachment({ id: '901', encryption: material });
    expect(seeded && memoryFs.read(seeded.uri)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('rejects with ApiError carrying the server error, and still cleans up', async () => {
    const { blob } = await encryptAttachment(photo());
    const p = messages.uploadAttachment('42', blob, { encrypted: true });
    FakeXHR.last!.respond(413, { error: 'attachment is too large', max_bytes: 26214400 });
    const err = (await p.catch((e: unknown) => e)) as InstanceType<typeof ApiError>;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('attachment is too large');
    expect(err.status).toBe(413);
    expect(err.body).toEqual({ error: 'attachment is too large', max_bytes: 26214400 });
    expect(memoryFs.exists(blob.uri)).toBe(false);
  });

  it('falls back to the status for a non-JSON error and flags a bad success body', async () => {
    const p1 = messages.uploadAttachment('1', photo());
    FakeXHR.last!.respond(502, '<html>bad gateway</html>');
    await expect(p1).rejects.toMatchObject({ message: 'HTTP 502', status: 502 });

    const p2 = messages.uploadAttachment('1', photo());
    FakeXHR.last!.respond(201, 'not json');
    await expect(p2).rejects.toMatchObject({ message: 'Invalid upload response', status: 201 });
  });

  it('reports a network error as ApiError status 0', async () => {
    const p = messages.uploadAttachment('1', photo());
    FakeXHR.last!.onerror!();
    await expect(p).rejects.toMatchObject({ message: 'Network error during upload', status: 0 });
  });

  it('cancels through the AbortSignal with an AbortError', async () => {
    const controller = new AbortController();
    const p = messages.uploadAttachment('1', photo(), { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXHR.last!.aborted).toBe(true);

    // Already aborted: no request at all.
    FakeXHR.last = null;
    await expect(messages.uploadAttachment('1', photo(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXHR.last).toBeNull();
  });
});
