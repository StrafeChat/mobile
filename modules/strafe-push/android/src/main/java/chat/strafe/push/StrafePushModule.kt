package chat.strafe.push

import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.ResolvedDistributor
import java.util.concurrent.Executors

class PushStringsRecord : Record {
  @Field var appName: String? = null
  @Field var newMessage: String? = null
  @Field var encryptedMessage: String? = null
  @Field var attachment: String? = null
  @Field var spaceRoom: String? = null
  @Field var threadRoom: String? = null
  @Field var incomingCall: String? = null
  @Field var callFrom: String? = null
  @Field var callFromIn: String? = null
  @Field var markRead: String? = null
  @Field var reply: String? = null
  @Field var answer: String? = null
  @Field var decline: String? = null
  @Field var testTitle: String? = null
  @Field var testBody: String? = null
  @Field var channelMessages: String? = null
  @Field var channelMessagesSilent: String? = null
  @Field var channelCalls: String? = null

  fun toStrings(): PushStrings {
    val d = PushStrings()
    fun pick(value: String?, fallback: String) = value?.takeIf { it.isNotBlank() } ?: fallback
    return PushStrings(
      appName = pick(appName, d.appName),
      newMessage = pick(newMessage, d.newMessage),
      encryptedMessage = pick(encryptedMessage, d.encryptedMessage),
      attachment = pick(attachment, d.attachment),
      spaceRoom = pick(spaceRoom, d.spaceRoom),
      threadRoom = pick(threadRoom, d.threadRoom),
      incomingCall = pick(incomingCall, d.incomingCall),
      callFrom = pick(callFrom, d.callFrom),
      callFromIn = pick(callFromIn, d.callFromIn),
      markRead = pick(markRead, d.markRead),
      reply = pick(reply, d.reply),
      answer = pick(answer, d.answer),
      decline = pick(decline, d.decline),
      testTitle = pick(testTitle, d.testTitle),
      testBody = pick(testBody, d.testBody),
      channelMessages = pick(channelMessages, d.channelMessages),
      channelMessagesSilent = pick(channelMessagesSilent, d.channelMessagesSilent),
      channelCalls = pick(channelCalls, d.channelCalls),
    )
  }
}

class DisplayAccountRecord : Record {
  @Field var slot: String = ""
  @Field var userId: String = ""
  @Field var label: String = ""
  @Field var apiBase: String = ""
  @Field var token: String? = null
}

class DisplayConfigRecord : Record {
  @Field var strings: PushStringsRecord = PushStringsRecord()
  @Field var accounts: List<DisplayAccountRecord> = emptyList()
  @Field var activeSlot: String? = null
  @Field var preview: Boolean = true
  @Field var sounds: Boolean = true
}

private class InvalidSlotException(slot: String) :
  CodedException("ERR_INVALID_SLOT", "strafe-push: invalid slot '$slot' (expected [A-Za-z0-9_-]{1,32})", null)

private class NoDistributorException(message: String) : CodedException("ERR_NO_DISTRIBUTOR", message, null)

/**
 * `StrafePush` (modules/strafe-push/index.ts) on Android: slot keys, FCM and UnifiedPush
 * registration, the display config the native renderer uses, and clearing notifications.
 */
class StrafePushModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val store: PushStore
    get() = PushStore.get(context)

  internal fun emit(name: String, body: Map<String, Any?>) {
    sendEvent(name, body)
  }

  override fun definition() = ModuleDefinition {
    Name("StrafePush")

    Events(PushEvents.FCM_TOKEN, PushEvents.UNIFIED_PUSH_ENDPOINT, PushEvents.UNIFIED_PUSH_UNREGISTERED, PushEvents.UNIFIED_PUSH_FAILED)

    OnCreate {
      PushEvents.attach(this@StrafePushModule)
    }

    OnDestroy {
      PushEvents.detach(this@StrafePushModule)
    }

    AsyncFunction("getCapabilities") {
      val pm = context.packageManager
      val distributors = unifiedPushDistributors()
      mapOf(
        "fcm" to Fcm.isAvailable(context),
        "apns" to false,
        "unifiedPush" to distributors.isNotEmpty(),
        "distributors" to distributors.map { mapOf("id" to it, "name" to appLabel(pm, it)) },
        "selectedDistributor" to UnifiedPush.getSavedDistributor(context),
      )
    }

    AsyncFunction("ensureKeys") { slot: String ->
      requireSlot(slot)
      val keys = store.ensureKeys(slot)
      mapOf("p256dh" to WebPushCrypto.base64UrlEncode(keys.publicKey), "auth" to WebPushCrypto.base64UrlEncode(keys.auth))
    }

    AsyncFunction("deleteKeys") { slot: String ->
      requireSlot(slot)
      store.deleteKeys(slot)
    }

    AsyncFunction("getFcmToken") {
      Fcm.token(context)
    }

    AsyncFunction("releaseFcm") {
      Fcm.release(context)
    }

    // Synchronous: +native-intent checks a link while the router waits for its answer.
    Function("getLinkKey") {
      store.linkKey()
    }

    AsyncFunction("getApnsEnvironment") {
      "production"
    }

    AsyncFunction("registerUnifiedPush") { slot: String, distributor: String?, promise: Promise ->
      requireSlot(slot)
      registerUnifiedPush(slot, distributor, promise)
    }

    AsyncFunction("unregisterUnifiedPush") { slot: String ->
      requireSlot(slot)
      UnifiedPush.unregister(context, slot, SlotKeyManager(context))
      store.removeUnifiedPushEndpoint(slot)
    }

    AsyncFunction("getUnifiedPushEndpoint") { slot: String ->
      requireSlot(slot)
      store.unifiedPushEndpoint(slot)?.toEvent()
    }

    AsyncFunction("setDisplayConfig") { record: DisplayConfigRecord ->
      val accounts = record.accounts.filter { Slots.isValid(it.slot) }
      val config = DisplayConfig(
        strings = record.strings.toStrings(),
        accounts = accounts.map { DisplayAccount(it.slot, it.userId, it.label, it.apiBase.trimEnd('/')) },
        activeSlot = record.activeSlot?.takeIf { Slots.isValid(it) },
        preview = record.preview,
        sounds = record.sounds,
      )
      accounts.forEach { store.setToken(it.slot, it.token) }
      store.retainTokens(accounts.map { it.slot }.toSet())
      store.setDisplayConfig(config)
      // Channel names follow the app's language from now on, before any push arrives.
      PushNotifier(context).ensureChannels(config.strings)
    }

    AsyncFunction("clearRoom") { slot: String, roomId: String ->
      requireSlot(slot)
      PushNotifier(context).clearRoom(slot, roomId, store.displayConfig())
    }

    AsyncFunction("clearAll") { slot: String? ->
      slot?.let { requireSlot(it) }
      PushNotifier(context).clearAll(slot)
    }
  }

  private fun requireSlot(slot: String) {
    if (!Slots.isValid(slot)) throw InvalidSlotException(slot)
  }

  /** Installed distributors, not counting ourselves. */
  private fun unifiedPushDistributors(): List<String> =
    UnifiedPush.getDistributors(context).filter { it != context.packageName }

  private fun appLabel(pm: PackageManager, packageName: String): String =
    try {
      pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
      packageName
    }

  /**
   * Binds [slot] to UnifiedPush: through [distributor] when given, else the saved one, else
   * the system default (which may ask the person to pick, hence an activity). The endpoint
   * comes later, as the `unifiedPushEndpoint` event.
   */
  private fun registerUnifiedPush(slot: String, distributor: String?, promise: Promise) {
    val installed = unifiedPushDistributors()
    if (distributor != null) {
      if (distributor !in installed) {
        promise.reject(NoDistributorException("UnifiedPush distributor $distributor is not installed"))
        return
      }
      UnifiedPush.saveDistributor(context, distributor)
      registerSlot(slot)
      promise.resolve(null)
      return
    }
    if (UnifiedPush.getSavedDistributor(context) != null) {
      registerSlot(slot)
      promise.resolve(null)
      return
    }
    when (val resolved = UnifiedPush.resolveDefaultDistributor(context)) {
      is ResolvedDistributor.Found -> {
        UnifiedPush.saveDistributor(context, resolved.packageName)
        registerSlot(slot)
        promise.resolve(null)
      }
      ResolvedDistributor.NoneAvailable -> promise.reject(NoDistributorException("no UnifiedPush distributor is installed"))
      ResolvedDistributor.ToSelect -> {
        // Several distributors and no system default: the connector asks the person.
        val activity = appContext.currentActivity
        if (activity == null) {
          promise.reject(NoDistributorException("choosing a UnifiedPush distributor needs the app in the foreground"))
          return
        }
        activity.runOnUiThread {
          UnifiedPush.tryUseDefaultDistributor(activity) { chosen ->
            background.execute {
              if (chosen) {
                registerSlot(slot)
                promise.resolve(null)
              } else {
                promise.reject(NoDistributorException("no UnifiedPush distributor was chosen"))
              }
            }
          }
        }
      }
    }
  }

  /**
   * Sends the registration with the slot's instance VAPID key when we can get it: some
   * distributors require one (VAPID_REQUIRED otherwise) and it lets the push server refuse
   * pushes not signed by the instance. The key comes from the account's apiBase in the
   * display config (fresh, else the last one seen).
   */
  private fun registerSlot(slot: String) {
    val account = store.displayConfig().account(slot)
    val vapid = account?.let { PushHttp.vapidKey(it.apiBase) }?.also { store.setVapidKey(slot, it) } ?: store.vapidKey(slot)
    val keyManager = SlotKeyManager(context)
    try {
      UnifiedPush.register(context, slot, null, vapid, keyManager)
    } catch (e: UnifiedPush.VapidNotValidException) {
      Log.w(TAG, "instance VAPID key rejected by the connector, registering without it")
      UnifiedPush.register(context, slot, null, null, keyManager)
    }
  }

  private companion object {
    const val TAG = "StrafePush"
    val background = Executors.newSingleThreadExecutor()
  }
}
