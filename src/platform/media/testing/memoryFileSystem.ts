/**
 * An in-memory stand-in for the slice of expo-file-system the media layer uses (File,
 * Directory, Paths, File.downloadFileAsync), for jest:
 *
 *   jest.mock('expo-file-system', () => require('<relative path>/testing/memoryFileSystem'));
 *
 * It is strict where the native module is (writing into a missing directory, deleting a
 * missing file and moving onto an existing one all throw), so a test catches the same
 * mistakes a device would. `memoryFs` seeds files and the "network" downloads read from, and
 * counts downloads.
 */

type FsNode = { kind: 'file'; data: Uint8Array; mtime: number; declaredSize?: number } | { kind: 'dir' };

const nodes = new Map<string, FsNode>();
const network = new Map<string, Uint8Array | number>();
let downloads: string[] = [];
let clock = 1_000;

function norm(uri: string): string {
  return uri.replace(/\/+$/, '');
}

function join(parts: Array<string | MemFile | MemDirectory>): string {
  let out = '';
  for (const p of parts) {
    const s = typeof p === 'string' ? p : p.uri;
    out = out ? `${norm(out)}/${s.replace(/^\/+/, '')}` : s;
  }
  return norm(out);
}

function parentOf(uri: string): string {
  const u = norm(uri);
  return u.slice(0, u.lastIndexOf('/'));
}

function basename(uri: string): string {
  const u = norm(uri);
  return u.slice(u.lastIndexOf('/') + 1);
}

function requireDir(uri: string): void {
  if (nodes.get(norm(uri))?.kind !== 'dir') throw new Error(`no such directory: ${uri}`);
}

export class MemFile {
  private path: string;

  constructor(...uris: Array<string | MemFile | MemDirectory>) {
    this.path = join(uris);
  }

  get uri(): string {
    return this.path;
  }

  get name(): string {
    return basename(this.path);
  }

  get extension(): string {
    const n = this.name;
    const dot = n.lastIndexOf('.');
    return dot > 0 ? n.slice(dot) : '';
  }

  get parentDirectory(): MemDirectory {
    return new MemDirectory(parentOf(this.path));
  }

  get exists(): boolean {
    return nodes.get(this.path)?.kind === 'file';
  }

  private node(): Extract<FsNode, { kind: 'file' }> {
    const n = nodes.get(this.path);
    if (n?.kind !== 'file') throw new Error(`no such file: ${this.path}`);
    return n;
  }

  get size(): number {
    const n = this.node();
    return n.declaredSize ?? n.data.length;
  }

  get modificationTime(): number | null {
    return this.exists ? this.node().mtime : null;
  }

  async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return this.bytesSync() as Uint8Array<ArrayBuffer>;
  }

  bytesSync(): Uint8Array {
    const n = this.node();
    if (n.declaredSize !== undefined) throw new Error('memoryFs: a sparse file must not be read');
    return new Uint8Array(n.data);
  }

  create(opts: { overwrite?: boolean } = {}): void {
    requireDir(parentOf(this.path));
    if (this.exists && !opts.overwrite) throw new Error(`file exists: ${this.path}`);
    nodes.set(this.path, { kind: 'file', data: new Uint8Array(0), mtime: ++clock });
  }

  write(content: string | Uint8Array): void {
    requireDir(parentOf(this.path));
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
    nodes.set(this.path, { kind: 'file', data, mtime: ++clock });
  }

  delete(): void {
    this.node();
    nodes.delete(this.path);
  }

  private target(dest: MemFile | MemDirectory): string {
    return dest instanceof MemDirectory ? join([dest.uri, this.name]) : dest.uri;
  }

  moveSync(dest: MemFile | MemDirectory, opts: { overwrite?: boolean } = {}): void {
    const n = this.node();
    const to = this.target(dest);
    requireDir(parentOf(to));
    if (nodes.has(to) && !opts.overwrite) throw new Error(`destination exists: ${to}`);
    nodes.delete(this.path);
    nodes.set(to, n);
    this.path = to;
  }

  /** Asynchronous, as the native module's is (moveSync is the synchronous one). */
  async move(dest: MemFile | MemDirectory, opts?: { overwrite?: boolean }): Promise<void> {
    await Promise.resolve();
    this.moveSync(dest, opts);
  }

  copySync(dest: MemFile | MemDirectory, opts: { overwrite?: boolean } = {}): void {
    const n = this.node();
    const to = this.target(dest);
    requireDir(parentOf(to));
    if (nodes.has(to) && !opts.overwrite) throw new Error(`destination exists: ${to}`);
    nodes.set(to, { kind: 'file', data: new Uint8Array(n.data), mtime: ++clock });
  }

  async copy(dest: MemFile | MemDirectory, opts?: { overwrite?: boolean }): Promise<void> {
    await Promise.resolve();
    this.copySync(dest, opts);
  }

  open(): { readBytes(length: number): Uint8Array; close(): void } {
    const data = this.node().data;
    let offset = 0;
    return {
      readBytes(length: number) {
        const out = data.slice(offset, offset + length);
        offset += out.length;
        return out;
      },
      close() {
        /* nothing to release */
      },
    };
  }

  info(): { exists: boolean; size?: number; uri: string } {
    return this.exists ? { exists: true, size: this.size, uri: this.path } : { exists: false, uri: this.path };
  }

  static async downloadFileAsync(
    url: string,
    dest: MemFile | MemDirectory,
    opts: { idempotent?: boolean; onProgress?: (p: { bytesWritten: number; totalBytes: number }) => void } = {},
  ): Promise<MemFile> {
    downloads.push(url);
    const body = network.get(url);
    if (body === undefined) throw new Error(`UnableToDownload: 404 ${url}`);
    if (typeof body === 'number') throw new Error(`UnableToDownload: ${body} ${url}`);
    const file = dest instanceof MemDirectory ? new MemFile(dest, basename(url)) : dest;
    if (file.exists && !opts.idempotent) throw new Error('DestinationAlreadyExists');
    file.write(body);
    opts.onProgress?.({ bytesWritten: body.length, totalBytes: body.length });
    return file;
  }
}

export class MemDirectory {
  private path: string;

  constructor(...uris: Array<string | MemFile | MemDirectory>) {
    this.path = join(uris);
  }

  get uri(): string {
    return `${this.path}/`;
  }

  get name(): string {
    return basename(this.path);
  }

  get parentDirectory(): MemDirectory {
    return new MemDirectory(parentOf(this.path));
  }

  get exists(): boolean {
    return nodes.get(this.path)?.kind === 'dir';
  }

  create(opts: { intermediates?: boolean; idempotent?: boolean } = {}): void {
    if (this.exists) {
      if (opts.idempotent) return;
      throw new Error(`directory exists: ${this.path}`);
    }
    const parent = parentOf(this.path);
    if (nodes.get(parent)?.kind !== 'dir') {
      if (!opts.intermediates) throw new Error(`no such directory: ${parent}`);
      new MemDirectory(parent).create({ intermediates: true, idempotent: true });
    }
    nodes.set(this.path, { kind: 'dir' });
  }

  delete(): void {
    if (!this.exists) throw new Error(`no such directory: ${this.path}`);
    for (const key of [...nodes.keys()]) {
      if (key === this.path || key.startsWith(`${this.path}/`)) nodes.delete(key);
    }
  }

  list(): Array<MemFile | MemDirectory> {
    requireDir(this.path);
    const out: Array<MemFile | MemDirectory> = [];
    for (const [key, node] of nodes) {
      if (parentOf(key) !== this.path) continue;
      out.push(node.kind === 'dir' ? new MemDirectory(key) : new MemFile(key));
    }
    return out;
  }
}

/** The root everything hangs off; `Paths.cache` is under it. */
const ROOT = 'file:///data';

export const Paths = {
  get cache(): MemDirectory {
    return new MemDirectory(`${ROOT}/cache`);
  },
  get document(): MemDirectory {
    return new MemDirectory(`${ROOT}/documents`);
  },
};

export { MemFile as File, MemDirectory as Directory };

/** Test controls. */
export const memoryFs = {
  reset(): void {
    nodes.clear();
    network.clear();
    downloads = [];
    nodes.set(ROOT, { kind: 'dir' });
    nodes.set(`${ROOT}/cache`, { kind: 'dir' });
    nodes.set(`${ROOT}/documents`, { kind: 'dir' });
  },
  /** Write a file (creating its directories). Returns its URI. */
  put(uri: string, data: Uint8Array | string): string {
    new MemDirectory(parentOf(uri)).create({ intermediates: true, idempotent: true });
    new MemFile(uri).write(data);
    return norm(uri);
  },
  /** A file that reports `size` bytes but throws if anyone reads it. */
  putSparse(uri: string, size: number): string {
    new MemDirectory(parentOf(uri)).create({ intermediates: true, idempotent: true });
    nodes.set(norm(uri), { kind: 'file', data: new Uint8Array(0), mtime: ++clock, declaredSize: size });
    return norm(uri);
  },
  read(uri: string): Uint8Array | null {
    const n = nodes.get(norm(uri));
    return n?.kind === 'file' ? new Uint8Array(n.data) : null;
  },
  exists(uri: string): boolean {
    return nodes.has(norm(uri));
  },
  /** Delete a file behind the app's back (the OS reclaiming cache space). */
  remove(uri: string): void {
    nodes.delete(norm(uri));
  },
  /** Files directly or indirectly under `dirUri`. */
  filesUnder(dirUri: string): string[] {
    const prefix = `${norm(dirUri)}/`;
    return [...nodes.entries()].filter(([k, n]) => n.kind === 'file' && k.startsWith(prefix)).map(([k]) => k);
  },
  /** Serve `body` for downloads of `url` (a number is an HTTP error status). */
  serve(url: string, body: Uint8Array | number): void {
    network.set(url, body);
  },
  downloads(): string[] {
    return [...downloads];
  },
  cacheUri: `${ROOT}/cache`,
};

memoryFs.reset();
