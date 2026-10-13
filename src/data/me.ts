/**
 * The signed-in account, its session and the instance it lives on.
 *
 * Everything here reads the web stores (stores/auth, stores/instance, stores/stargate,
 * stores/presence) that READY hydration fills; nothing is fetched. Actions (logout, patchMe,
 * setUserPresence...) are the web's own - call them directly from handlers.
 */
import { auth, type AuthState } from '@web/stores/auth';
import { instance, formatHandle } from '@web/stores/instance';
import { stargate } from '@web/stores/stargate';
import { presence, type UserPresence } from '@web/stores/presence';
import { useSolid } from '@/bridge/solid';
import { instanceVersion } from '@/platform/overrides/runtime/instance';

export type AuthUser = NonNullable<AuthState['user']>;

/** The signed-in user (null when signed out). Re-renders when any profile field changes. */
export function useMe(): AuthUser | null {
  return useSolid(() => auth.user);
}

/** Just the id - for components that only need to compare. Re-renders on sign-in/out. */
export function useMyId(): string | null {
  return useSolid(() => auth.user?.id ?? null);
}

export interface SessionState {
  /** A token is stored (signed in, possibly still waiting for READY). */
  signedIn: boolean;
  /** READY (or the REST fallback) has filled the stores. Read-state snapshots wait for it. */
  hydrated: boolean;
  loading: boolean;
}

/** Re-renders on sign-in/out and when hydration completes. */
export function useSession(): SessionState {
  return useSolid(() => ({ signedIn: !!auth.token, hydrated: auth.hydrated, loading: auth.loading }));
}

/** The user's own presence, as the status dot reads it ('offline' when unknown).
 * Re-renders on the user's own PRESENCE_UPDATE. */
export function useSelfPresence(): UserPresence {
  return useSolid(() => {
    const id = auth.user?.id;
    const p = id ? presence.byUser[id] : undefined;
    return { status: p?.status ?? 'offline', ...(p?.custom_status ? { custom_status: p.custom_status } : {}) };
  });
}

export interface InstanceInfo {
  loaded: boolean;
  version: string;
  federationEnabled: boolean;
  /** This instance's federation domain ('' when federation is off). */
  domain: string;
  voiceEnabled: boolean;
  inviteOnly: boolean;
  emailEnabled: boolean;
  /** The signed-in account administers this instance (decides whether admin entry points exist). */
  instanceAdmin: boolean;
}

/** What the app knows about its instance. Re-renders when /, or /instance/me, answers. */
export function useInstance(): InstanceInfo {
  return useSolid(() => ({
    loaded: instance.loaded,
    version: instanceVersion(),
    federationEnabled: instance.federationEnabled,
    domain: instance.domain,
    voiceEnabled: instance.voiceEnabled,
    inviteOnly: instance.inviteOnly,
    emailEnabled: instance.email.enabled,
    instanceAdmin: instance.instanceAdmin,
  }));
}

export interface ConnectionState {
  status: (typeof stargate)['status'];
  /** READY received on the current socket. */
  ready: boolean;
  error: string | null;
}

/** The gateway connection, for the "Reconnecting…" banner. Re-renders on status changes. */
export function useConnection(): ConnectionState {
  return useSolid(() => ({ status: stargate.status, ready: stargate.ready, error: stargate.error }));
}

/** `name` or `name@domain` for a remote user - what someone types to add them. Re-renders
 * when the instance's domain becomes known. */
export function useHandle(user: { username?: string; home_domain?: string } | null | undefined): string {
  const username = user?.username;
  const home = user?.home_domain;
  return useSolid(() => formatHandle({ username, home_domain: home }), [username, home]);
}
