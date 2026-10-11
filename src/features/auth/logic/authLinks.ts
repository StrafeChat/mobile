/**
 * Email links into the auth screens.
 *
 * Verification and reset emails link to the instance's web client
 * (https://<instance>/verify-email?token=..., /reset-password?token=...). The app cannot claim
 * those links for every self-hosted domain, so they usually open in the browser, which handles
 * them. When one does reach the app - the app's own scheme (strafe://verify-email?token=...),
 * an https link the OS handed over, or a link pasted into the screen - this turns it into a
 * token for the right screen, plus the instance it came from when the link says.
 *
 * Parsed by hand rather than with URL: custom-scheme URLs are where URL implementations
 * disagree, and this runs on Hermes with a polyfill.
 */
export type AuthLinkKind = 'verify-email' | 'reset-password';

export interface AuthLink {
  kind: AuthLinkKind;
  token: string;
  /**
   * The instance the link belongs to: the host of an https link, or the `instance` parameter
   * of an app-scheme link. null when the link does not say (use the chosen instance).
   */
  instance: string | null;
}

const APP_SCHEMES = new Set(['strafe']);
const KINDS: readonly AuthLinkKind[] = ['verify-email', 'reset-password'];

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** The query of a URL as a map (first value wins). */
export function queryParams(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of query.replace(/^\?/, '').split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = decode(eq < 0 ? part : part.slice(0, eq));
    const v = decode(eq < 0 ? '' : part.slice(eq + 1));
    if (k && !(k in out)) out[k] = v;
  }
  return out;
}

/** Tokens are URL-safe random strings; anything else is not one. */
const TOKEN_RE = /^[A-Za-z0-9_\-.~]{16,512}$/;

export function isPlausibleToken(s: string): boolean {
  return TOKEN_RE.test(s.trim());
}

/** A verify-email / reset-password link, or null. */
export function parseAuthLink(raw: string): AuthLink | null {
  const s = raw.trim();
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?/i.exec(s);
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  const authority = m[2] ?? '';
  const path = m[3] ?? '';
  const params = queryParams(m[4] ?? '');
  let route: string;
  let instance: string | null;
  if (scheme === 'http' || scheme === 'https') {
    route = path;
    instance = authority.replace(/^[^@]*@/, '').toLowerCase() || null;
  } else if (APP_SCHEMES.has(scheme)) {
    // strafe://verify-email?token= (authority is the route) or strafe:///verify-email?token=
    route = `${authority}/${path}`;
    instance = params.instance?.trim().toLowerCase() || null;
  } else {
    return null;
  }
  const segments = route.split('/').filter(Boolean);
  const kind = segments[segments.length - 1] as AuthLinkKind | undefined;
  if (!kind || !KINDS.includes(kind)) return null;
  const token = (params.token ?? '').trim();
  if (!token) return null;
  return { kind, token, instance };
}

/**
 * What the person pasted into a "link from the email" field: the whole link, or just the
 * token. A link for the other screen is refused (null), as is anything that is not a token.
 */
export function tokenFromPaste(raw: string, kind: AuthLinkKind): { token: string; instance: string | null } | null {
  const link = parseAuthLink(raw);
  if (link) return link.kind === kind ? { token: link.token, instance: link.instance } : null;
  const s = raw.trim();
  return isPlausibleToken(s) ? { token: s, instance: null } : null;
}

/** "chat.example.org:8443" and "Chat.Example.org" name the same instance as "chat.example.org". */
export function sameInstanceHost(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (h: string) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:443$/, '');
  return norm(a) === norm(b);
}
