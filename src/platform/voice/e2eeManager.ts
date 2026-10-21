/**
 * LiveKit's E2EE manager for React Native, rebuilt to be strict about plaintext.
 *
 * In the browser LiveKit encrypts frames in a worker through insertable streams; on a phone
 * the native FrameCryptor does it, attached to each RTP sender and receiver. The SDK's own
 * RNE2EEManager (@livekit/react-native, marked experimental) does that attaching, but in
 * three ways that do not hold up for calls that must never fall back to the clear:
 *
 * 1. It attaches the sender's cryptor on LocalTrackPublished, which LiveKit emits *after*
 *    the track has been negotiated - media can already be flowing, unencrypted, by then.
 *    Here it is attached on LocalSenderCreated, which fires as soon as the sender exists
 *    and before the offer that carries it is even created, so no frame can leave before
 *    the cryptor is in place (frames need the SDP answer and DTLS first).
 * 2. It sets the sender's key index once. The native sender encrypts with an explicit
 *    index (the JS worker follows the last key set), so after a rotation the phone would
 *    keep using the old slot. Here every key installed for an identity moves that
 *    identity's cryptors to the new slot.
 * 3. It skips tracks whose publication is not marked encrypted, i.e. it would play a
 *    participant's media as-is if they published in the clear. Here every subscribed
 *    track gets an enabled decrypting cryptor: a plaintext frame fails to decrypt and is
 *    dropped instead of played.
 *
 * Like livekit-client's own manager (and unlike RNE2EEManager), it reports each remote
 * participant's encryption status from their publications - on TrackPublished, and for
 * every existing one on connecting - so the voice store's ParticipantEncryptionStatusChanged
 * handler can refuse a participant publishing in the clear before their media is subscribed.
 *
 * And it never turns a sender's cryptor off (an off cryptor passes frames through): it is
 * disposed only once its track is unpublished, i.e. once the sender has stopped.
 *
 * Data-channel encryption is not used for calls (the Room is given `e2ee`, not
 * `encryption`), so the data packet methods refuse rather than half-implement it.
 */
import {
  ConnectionState,
  EncryptionEvent,
  ParticipantEvent,
  RoomEvent,
  type BaseE2EEManager,
  type DecryptDataResponseMessage,
  type E2EEManagerCallbacks,
  type EncryptDataResponseMessage,
  type LocalTrack,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
} from 'livekit-client';
import {
  RTCFrameCryptorAlgorithm,
  RTCFrameCryptorFactory,
  type RTCFrameCryptor,
  type RTCRtpReceiver,
  type RTCRtpSender,
} from '@livekit/react-native-webrtc';
import type { CallKeyProvider } from './keyProvider';
import { forgetTrackSender, noteTrackSender } from './senders';

/**
 * Cryptor states worth reporting. The native modules send the state's name; the typings
 * say RTCFrameCryptorState (2 encryptionFailed, 3 decryptionFailed, 4 missingKey,
 * 6 internalError) - both are accepted.
 */
const FAILED_STATES = new Set<unknown>(['encryptionFailed', 'decryptionFailed', 'missingKey', 'internalError', 2, 3, 4, 6]);
/** How long after a hang-up the native objects are freed if the room never reports it. */
const DISPOSE_FALLBACK_MS = 10_000;

interface CryptorEntry {
  cryptor: RTCFrameCryptor;
  identity: string;
  side: 'send' | 'receive';
  /** The LiveKit track it serves (a sender's track is known before its sid is). */
  track: LocalTrack | RemoteTrack;
  trackSid?: string;
  onState: (ev: { state?: unknown }) => void;
}

type ManagerEvent = keyof E2EEManagerCallbacks;

export class CallE2EEManager implements BaseE2EEManager {
  private readonly handlers = new Map<ManagerEvent, Set<(...args: never[]) => void>>();
  private room?: Room;
  private readonly entries: CryptorEntry[] = [];
  private encryptionEnabled = false;
  private terminated = false;
  private disposed = false;
  private readonly stopKeyListener: () => void;

  constructor(private readonly keyProvider: CallKeyProvider) {
    this.stopKeyListener = keyProvider.onKeySet((identity, index) => {
      for (const e of this.entries) {
        if (e.identity === identity) void e.cryptor.setKeyIndex(index).catch((err) => this.reportError(err, identity));
      }
    });
  }

  // The two events the Room listens for. A tiny emitter rather than Node's `events`, which
  // has no typings in this app.
  on<E extends ManagerEvent>(event: E, listener: E2EEManagerCallbacks[E]): this {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(listener as (...args: never[]) => void);
    return this;
  }

  off<E extends ManagerEvent>(event: E, listener: E2EEManagerCallbacks[E]): this {
    this.handlers.get(event)?.delete(listener as (...args: never[]) => void);
    return this;
  }

  private emit<E extends ManagerEvent>(event: E, ...args: Parameters<E2EEManagerCallbacks[E]>): void {
    for (const fn of [...(this.handlers.get(event) ?? [])]) {
      try {
        (fn as unknown as (...a: Parameters<E2EEManagerCallbacks[E]>) => void)(...args);
      } catch (err) {
        console.error('[voice-e2ee] listener threw', err);
      }
    }
  }

  get isEnabled(): boolean {
    return this.encryptionEnabled;
  }

  get isDataChannelEncryptionEnabled(): boolean {
    return false;
  }

  set isDataChannelEncryptionEnabled(_value: boolean) {
    /* calls never encrypt data packets; see the file comment */
  }

  setup(room: Room): void {
    if (this.room === room) return;
    this.room = room;
    room.localParticipant
      .on(ParticipantEvent.LocalSenderCreated, (sender, track) => {
        this.attachSender(sender as unknown as RTCRtpSender, track as LocalTrack);
      })
      .on(ParticipantEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
        const entry = this.entries.find((e) => e.side === 'send' && e.track === pub.track);
        if (entry) entry.trackSid = pub.trackSid;
        // Belt and braces: a publish path that did not announce its sender.
        else if (pub.track?.sender) this.attachSender(pub.track.sender as unknown as RTCRtpSender, pub.track as LocalTrack, pub.trackSid);
      })
      .on(ParticipantEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
        // The sender is out of the connection now, so nothing more can go through it.
        this.release((e) => e.side === 'send' && (e.track === pub.track || e.trackSid === pub.trackSid));
        if (pub.track) forgetTrackSender(pub.track.mediaStreamTrack);
      });
    room
      .on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        this.reportPublication(pub, participant.identity);
      })
      .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (state !== ConnectionState.Connected) return;
        room.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => this.reportPublication(pub, p.identity)));
      })
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        this.attachReceiver(track, pub.trackSid, participant.identity);
      })
      .on(RoomEvent.TrackUnsubscribed, (_track: RemoteTrack, pub: RemoteTrackPublication) => {
        this.release((e) => e.side === 'receive' && e.trackSid === pub.trackSid);
      })
      .on(RoomEvent.SignalConnected, () => {
        this.setParticipantCryptorEnabled(room.localParticipant.isE2EEEnabled, room.localParticipant.identity);
      })
      .on(RoomEvent.Disconnected, () => {
        if (this.terminated) this.dispose();
      });
  }

  setupEngine(): void {
    /* nothing to do: the cryptors hang off senders and receivers, not the engine */
  }

  setParticipantCryptorEnabled(enabled: boolean, participantIdentity: string): void {
    const room = this.room;
    if (!room) return;
    if (participantIdentity === room.localParticipant.identity) {
      if (this.encryptionEnabled === enabled) return;
      this.encryptionEnabled = enabled;
      this.emit(EncryptionEvent.ParticipantEncryptionStatusChanged, enabled, room.localParticipant);
      return;
    }
    const participant = room.getParticipantByIdentity(participantIdentity);
    if (participant) this.emit(EncryptionEvent.ParticipantEncryptionStatusChanged, enabled, participant);
  }

  setSifTrailer(trailer: Uint8Array): void {
    void this.keyProvider.setSifTrailer(trailer).catch((err) => this.reportError(err));
  }

  encryptData(_data: Uint8Array): Promise<EncryptDataResponseMessage['data']> {
    return Promise.reject(new Error('data channel encryption is not used in calls'));
  }

  handleEncryptedData(): Promise<DecryptDataResponseMessage['data']> {
    return Promise.reject(new Error('data channel encryption is not used in calls'));
  }

  /**
   * The call is over. Receivers go now; senders and the key provider once the room has
   * disconnected (a sender's cryptor must outlive the sender, see the file comment).
   */
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.stopKeyListener();
    this.release((e) => e.side === 'receive');
    const state = this.room?.state;
    if (!this.room || state === ConnectionState.Disconnected) {
      this.dispose();
      return;
    }
    // Should the Disconnected event never come, the peer connection is long closed by now.
    setTimeout(() => this.dispose(), DISPOSE_FALLBACK_MS);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terminated = true;
    this.stopKeyListener();
    this.release(() => true);
    this.keyProvider.dispose();
    this.handlers.clear();
  }

  /** For tests and diagnostics: how many cryptors are attached, by side. */
  cryptorCount(side: 'send' | 'receive'): number {
    return this.entries.filter((e) => e.side === side).length;
  }

  // ---- internals ---------------------------------------------------------------------------

  private attachSender(sender: RTCRtpSender, track: LocalTrack, trackSid?: string): void {
    const room = this.room;
    if (!room || this.disposed) return;
    noteTrackSender(track.mediaStreamTrack, sender);
    // A republish (reconnect) creates a fresh sender for the same track.
    this.release((e) => e.side === 'send' && e.track === track);
    const identity = room.localParticipant.identity;
    // A new native cryptor starts disabled, and disabled means frames pass through as they
    // are. Enabling it takes two native round trips; media needs the SDP answer and DTLS
    // first, so in practice it is on long before a frame is sent - but "in practice" is not
    // the rule. Until it is on, the track itself is held off (a disabled track sends silence
    // or black, which carries nothing), so not one real frame can leave unencrypted however
    // the two race. If enabling fails the track stays held: no media rather than plain media.
    const media = track.mediaStreamTrack as { enabled?: boolean } | undefined;
    const held = !!media && media.enabled !== false;
    if (held) media.enabled = false;
    const cryptor = RTCFrameCryptorFactory.createFrameCryptorForRtpSender(
      identity,
      sender,
      RTCFrameCryptorAlgorithm.kAesGcm,
      this.keyProvider.rtcKeyProvider,
    );
    this.adopt({ cryptor, identity, side: 'send', track, trackSid }, () => {
      // Released only if nothing muted the track meanwhile (mute also works by disabling it).
      if (held && media && !track.isMuted) media.enabled = true;
    });
  }

  /**
   * livekit-client's setParticipantCryptorEnabledForPublication: a remote publication's own
   * encryption flag decides the participant's status, reported as soon as the publication is
   * known - before anything of it is subscribed - so voice.ts can refuse one sent in the clear
   * (and clear the mark when they publish encrypted again). A publication without its track
   * info yet says nothing either way.
   */
  private reportPublication(pub: RemoteTrackPublication, identity: string): void {
    if (!pub.trackInfo) return;
    this.setParticipantCryptorEnabled(pub.isEncrypted, identity);
  }

  private attachReceiver(track: RemoteTrack, trackSid: string, identity: string): void {
    const receiver = track.receiver as unknown as RTCRtpReceiver | undefined;
    if (!receiver || this.terminated) return;
    if (this.entries.some((e) => e.side === 'receive' && e.trackSid === trackSid)) return;
    const cryptor = RTCFrameCryptorFactory.createFrameCryptorForRtpReceiver(
      identity,
      receiver,
      RTCFrameCryptorAlgorithm.kAesGcm,
      this.keyProvider.rtcKeyProvider,
    );
    this.adopt({ cryptor, identity, side: 'receive', track, trackSid });
  }

  private adopt(fields: Omit<CryptorEntry, 'onState'>, onEnabled?: () => void): void {
    const { cryptor, identity } = fields;
    const onState = (ev: { state?: unknown }) => {
      if (FAILED_STATES.has(ev.state)) this.reportError(new Error(`frame cryptor ${String(ev.state)}`), identity);
    };
    const entry: CryptorEntry = { ...fields, onState };
    this.entries.push(entry);
    cryptor.addEventListener('framecryptorstatechanged', onState as never);
    // Index first: an enabled cryptor with no key at its slot drops frames, never forwards.
    void cryptor
      .setKeyIndex(this.keyProvider.latestKeyIndex(identity))
      .then(() => cryptor.setEnabled(true))
      .then(() => onEnabled?.())
      .catch((err) => this.reportError(err, identity));
  }

  private release(match: (e: CryptorEntry) => boolean): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (!match(e)) continue;
      this.entries.splice(i, 1);
      e.cryptor.removeEventListener('framecryptorstatechanged', e.onState as never);
      void e.cryptor.dispose().catch(() => undefined);
    }
  }

  private reportError(err: unknown, identity?: string): void {
    const error = err instanceof Error ? err : new Error(String(err));
    this.emit(EncryptionEvent.EncryptionError, error, identity);
  }
}

/** One manager per call, around that call's key provider. */
export function createCallE2EEManager(keyProvider: CallKeyProvider): CallE2EEManager {
  return new CallE2EEManager(keyProvider);
}
