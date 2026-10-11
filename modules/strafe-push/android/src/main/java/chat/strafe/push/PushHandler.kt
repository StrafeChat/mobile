package chat.strafe.push

import android.content.Context
import android.util.Log
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner

/**
 * Where every push ends up, whatever carried it (FCM, UnifiedPush, the debug receiver):
 * decrypt with the slot's keys, check it is for that slot's account, then show, update or
 * clear notifications. Runs on a background thread, with or without the JavaScript app.
 */
object PushHandler {
  private const val TAG = "StrafePush"
  private const val MAX_BODY = 4096

  /** A push body as the transports deliver it: base64url aes128gcm (FCM data `p`, the debug broadcast). */
  fun handleEncoded(context: Context, slot: String?, body: String?) {
    if (!Slots.isValid(slot) || body.isNullOrEmpty()) return
    val bytes = try {
      WebPushCrypto.base64UrlDecode(body)
    } catch (e: WebPushException) {
      Log.w(TAG, "push body is not base64url")
      return
    }
    handleEncrypted(context, slot!!, bytes)
  }

  fun handleEncrypted(context: Context, slot: String, body: ByteArray) = guarded {
    if (body.size > MAX_BODY) return@guarded
    val keys = PushStore.get(context).loadKeys(slot)
    if (keys == null) {
      Log.w(TAG, "push for a slot without keys")
      return@guarded
    }
    val plaintext = try {
      WebPushCrypto.decrypt(body, keys)
    } catch (e: WebPushException) {
      Log.w(TAG, "push could not be decrypted: ${e.message}")
      return@guarded
    }
    handlePlaintext(context, slot, plaintext)
  }

  /** A decrypted payload (UnifiedPush hands these over after our key manager decrypted them). */
  fun handlePlaintext(context: Context, slot: String, plaintext: ByteArray) = guarded {
    val payload = PushPayload.parse(String(plaintext, Charsets.UTF_8)) ?: return@guarded
    val config = PushStore.get(context).displayConfig()
    val account = config.account(slot) ?: return@guarded
    if (account.userId != payload.userId) return@guarded
    dispatch(context, slot, account, config, payload)
  }

  /**
   * Runs one push's handling so that nothing in it can take the process down: this runs in
   * Firebase's service and in broadcast receivers, where an uncaught exception kills the app
   * (a keystore that throws a ProviderException on one device, a notification the system
   * refuses). The push is dropped and logged by type only - never its content.
   */
  private inline fun guarded(block: () -> Unit) {
    try {
      block()
    } catch (e: RuntimeException) {
      Log.w(TAG, "push dropped: ${e.javaClass.simpleName}")
    } catch (e: java.security.GeneralSecurityException) {
      Log.w(TAG, "push dropped: ${e.javaClass.simpleName}")
    }
  }

  private fun dispatch(context: Context, slot: String, account: DisplayAccount, config: DisplayConfig, p: PushPayload) {
    val notifier = PushNotifier(context)
    notifier.ensureChannels(config.strings)
    // The running app shows its own in-app notifications for the account it is signed in as.
    val suppressed = slot == config.activeSlot && isAppInForeground()
    when (p.type) {
      PushPayload.TYPE_MESSAGE -> if (!suppressed) notifier.showMessage(slot, account, config, p)
      PushPayload.TYPE_READ -> notifier.applyRead(slot, p.roomId!!, p.messageId!!, config)
      PushPayload.TYPE_CALL -> if (!suppressed) notifier.showCall(slot, account, config, p)
      PushPayload.TYPE_CALL_END -> notifier.cancelCall(slot, p.roomId!!)
      // Shown even in the foreground: someone pressed "Send a test notification" and the
      // in-app path has nothing to show for it.
      PushPayload.TYPE_TEST -> notifier.showTest(slot, account, config)
    }
  }

  /** Started or resumed: an activity of ours is visible. A process woken just for a push is CREATED at most. */
  fun isAppInForeground(): Boolean =
    try {
      ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    } catch (e: RuntimeException) {
      false
    }
}
