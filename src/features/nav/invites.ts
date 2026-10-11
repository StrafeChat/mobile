/**
 * Invite codes as people paste them into the app.
 *
 * The web's inviteCodeFromInput accepts a bare code, `code@domain`, or an invite URL - but a
 * URL from *another* instance comes back as its bare code, which this instance would then look
 * up as one of its own. Inside the app there is no "this origin" to land on, so a foreign link
 * has to become `code@thatdomain` for the local instance to join it over federation (the
 * server proxies `code@domain` to the space's origin). That is the one addition here; the code
 * grammar is still the web's parseInviteCode.
 */
import { inviteCodeFromInput, parseInviteCode } from '@web/api/spaces';
import { instance } from '@web/stores/instance';

/** Hosts that mean "this instance" (its federation domain and the web origin the app uses). */
function localHosts(): Set<string> {
  const hosts = new Set<string>();
  if (instance.domain) hosts.add(instance.domain.toLowerCase());
  try {
    const origin = typeof window !== 'undefined' ? window.location?.origin : undefined;
    if (origin) hosts.add(new URL(origin).host.toLowerCase());
  } catch {
    /* no location yet */
  }
  return hosts;
}

/**
 * The code to join from whatever was typed or pasted: `abc`, `abc@chat.example.com`, or an
 * invite URL from any Strafe instance. null when it is none of those.
 */
export function inviteCodeFromAnyInput(raw: string, local: ReadonlySet<string> = localHosts()): string | null {
  const s = raw.trim();
  const code = inviteCodeFromInput(s);
  if (!code) return null;
  const parsed = parseInviteCode(code);
  if (!parsed) return null;
  if (parsed.domain) return code;
  // A link: name its instance unless it is this one.
  const m = s.match(/^(?:https?:\/\/)?([^/?#\s]+)\/invite\//i);
  if (!m) return code;
  const host = m[1]!.toLowerCase();
  if (local.has(host)) return code;
  if (!/^[a-z0-9.-]+(?::\d+)?$/.test(host)) return null;
  return `${parsed.code}@${host}`;
}

/** The signed-in instance's web origin (the window.location shim), '' before one is known. */
export function webOrigin(): string {
  try {
    return typeof window !== 'undefined' ? (window.location?.origin ?? '') : '';
  } catch {
    return '';
  }
}

/** The shareable link for an invite on this instance: `<web origin>/invite/<code>`. */
export function inviteLink(code: string): string {
  const origin = webOrigin();
  return origin ? `${origin}/invite/${code}` : code;
}

/** "Copy room link": the web route of a space room on this instance. */
export function roomLink(spaceId: string, roomId: string): string {
  return `${webOrigin()}/spaces/${spaceId}/rooms/${roomId}`;
}
