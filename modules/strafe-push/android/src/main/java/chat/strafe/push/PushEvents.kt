package chat.strafe.push

import java.lang.ref.WeakReference

/**
 * Hands events from the services and receivers to the JavaScript module, when there is one.
 * Nothing is queued: whatever an event carries is also persisted, and JS reads it back
 * (getFcmToken, getUnifiedPushEndpoint) when it starts.
 */
internal object PushEvents {
  const val FCM_TOKEN = "fcmToken"
  const val UNIFIED_PUSH_ENDPOINT = "unifiedPushEndpoint"
  const val UNIFIED_PUSH_UNREGISTERED = "unifiedPushUnregistered"
  const val UNIFIED_PUSH_FAILED = "unifiedPushFailed"

  @Volatile private var module: WeakReference<StrafePushModule>? = null

  fun attach(m: StrafePushModule) {
    module = WeakReference(m)
  }

  fun detach(m: StrafePushModule) {
    if (module?.get() === m) module = null
  }

  fun emit(name: String, body: Map<String, Any?>) {
    module?.get()?.emit(name, body)
  }
}
