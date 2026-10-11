/**
 * `localStorage` / `sessionStorage` for the shared web stores, on MMKV.
 *
 * `sessionStorage` is in-memory: on the web it lives as long as the tab, and the closest
 * thing an app has to a tab is the process.
 */
import { webStorage } from '../storage';

class MMKVStorage implements Storage {
  get length(): number {
    return webStorage.getAllKeys().length;
  }
  clear(): void {
    webStorage.clearAll();
  }
  getItem(key: string): string | null {
    return webStorage.getString(String(key)) ?? null;
  }
  key(index: number): string | null {
    return webStorage.getAllKeys()[index] ?? null;
  }
  removeItem(key: string): void {
    webStorage.remove(String(key));
  }
  setItem(key: string, value: string): void {
    webStorage.set(String(key), String(value));
  }
  [name: string]: unknown;
}

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(String(key)) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(String(key));
  }
  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value));
  }
  [name: string]: unknown;
}

const g = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage };
if (!g.localStorage) g.localStorage = new MMKVStorage();
if (!g.sessionStorage) g.sessionStorage = new MemoryStorage();
