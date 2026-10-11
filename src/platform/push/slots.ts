/**
 * Push slots: the native module's name for "one signed-in account" (its own Web Push keys,
 * its own endpoint, its own notifications), `[A-Za-z0-9_-]{1,32}`.
 *
 * Accounts are `${domain}:${userId}` (web/src/desktop/accounts.ts), which is neither in the
 * slot charset nor short enough. The slot is `<8 hex of the domain's hash>_<user id>`, and
 * the mapping is kept, so a slot never changes under an account once its keys exist (an
 * endpoint and its keys are bound to the slot on the instance's side), and two accounts
 * can never end up sharing one even if a hash or a truncation collides.
 */
import { appStorage } from '../storage';

const SLOTS_KEY = 'strafe.push.slots';
const SLOT_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** FNV-1a, 32 bits: a short, stable, non-cryptographic fingerprint. */
export function fnv1a(input: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 64 bits of fingerprint as 16 hex characters (two differently seeded FNV-1a passes). */
export function fingerprint(input: string): string {
  return fnv1a(input).toString(16).padStart(8, '0') + fnv1a(input, 0x9e3779b9).toString(16).padStart(8, '0');
}

export function isValidSlot(slot: string): boolean {
  return SLOT_RE.test(slot);
}

type SlotMap = Record<string, string>;

function readMap(): SlotMap {
  try {
    const raw = appStorage.getString(SLOTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: SlotMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && isValidSlot(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: SlotMap): void {
  if (Object.keys(map).length === 0) appStorage.remove(SLOTS_KEY);
  else appStorage.set(SLOTS_KEY, JSON.stringify(map));
}

/** What the slot of `accountId` would be with nothing taken yet. */
export function baseSlot(accountId: string): string {
  const sep = accountId.lastIndexOf(':');
  const domain = sep >= 0 ? accountId.slice(0, sep) : '';
  const user = (sep >= 0 ? accountId.slice(sep + 1) : accountId).replace(/[^A-Za-z0-9_-]/g, '_');
  const prefix = fnv1a(domain.toLowerCase()).toString(16).padStart(8, '0');
  return `${prefix}_${user}`.slice(0, 32);
}

/** The slot of an account, assigned (and remembered) on first use. */
export function slotFor(accountId: string): string {
  const map = readMap();
  const known = map[accountId];
  if (known) return known;
  const taken = new Set(Object.values(map));
  let slot = baseSlot(accountId);
  for (let n = 2; taken.has(slot); n++) {
    const suffix = `-${n}`;
    slot = baseSlot(accountId).slice(0, 32 - suffix.length) + suffix;
  }
  map[accountId] = slot;
  writeMap(map);
  return slot;
}

/** The slot already assigned to an account, without assigning one. */
export function existingSlot(accountId: string): string | null {
  return readMap()[accountId] ?? null;
}

/** The account a slot belongs to, if it is still mapped. */
export function accountForSlot(slot: string): string | null {
  for (const [accountId, s] of Object.entries(readMap())) if (s === slot) return accountId;
  return null;
}

/** Every mapped (account, slot) pair. */
export function mappedSlots(): { accountId: string; slot: string }[] {
  return Object.entries(readMap()).map(([accountId, slot]) => ({ accountId, slot }));
}

export function releaseSlot(accountId: string): void {
  const map = readMap();
  if (!(accountId in map)) return;
  delete map[accountId];
  writeMap(map);
}
