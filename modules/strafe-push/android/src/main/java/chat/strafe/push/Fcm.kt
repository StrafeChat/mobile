package chat.strafe.push

import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONException
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Firebase Cloud Messaging, initialised by hand from the build's `extra.fcm` (which
 * plugins/withStrafePushAndroid.js writes into the manifest as the `chat.strafe.push.fcm`
 * meta-data) - no google-services.json, no Google Gradle plugin. A build without it has no
 * FCM at all and pushes over UnifiedPush only.
 *
 * The values come from the manifest rather than from JavaScript because the process a push
 * wakes up has no JavaScript running, and Firebase must be initialised before its service
 * can deliver anything.
 */
internal object Fcm {
  private const val TAG = "StrafePush"
  private const val META_DATA = "chat.strafe.push.fcm"
  private const val TOKEN_TIMEOUT_S = 30L

  private data class Config(val projectId: String, val applicationId: String, val apiKey: String, val senderId: String)

  @Volatile private var cachedConfig: Config? = null
  @Volatile private var configRead = false

  private fun config(context: Context): Config? {
    if (configRead) return cachedConfig
    val raw = try {
      context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData?.getString(META_DATA)
    } catch (e: PackageManager.NameNotFoundException) {
      null
    }
    cachedConfig = raw?.let {
      try {
        val o = JSONObject(it)
        Config(o.getString("projectId"), o.getString("applicationId"), o.getString("apiKey"), o.getString("senderId"))
          .takeIf { c -> listOf(c.projectId, c.applicationId, c.apiKey, c.senderId).none(String::isBlank) }
      } catch (e: JSONException) {
        Log.w(TAG, "malformed FCM config in the manifest")
        null
      }
    }
    configRead = true
    return cachedConfig
  }

  fun isConfigured(context: Context): Boolean = config(context) != null

  /** This build carries Firebase config and the device has working Google Play services. */
  fun isAvailable(context: Context): Boolean =
    isConfigured(context) &&
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

  /** The default FirebaseApp, initialised from our config if nobody has yet; null without config. */
  @Synchronized
  fun ensureApp(context: Context): FirebaseApp? {
    val config = config(context) ?: return null
    FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }?.let { return it }
    return try {
      FirebaseApp.initializeApp(
        context.applicationContext,
        FirebaseOptions.Builder()
          .setProjectId(config.projectId)
          .setApplicationId(config.applicationId)
          .setApiKey(config.apiKey)
          .setGcmSenderId(config.senderId)
          .build(),
      )
    } catch (e: IllegalStateException) {
      FirebaseApp.getInstance()
    }
  }

  /**
   * The registration token, fetching one if needed (blocking; call off the main thread).
   * Calling this is what opts the device in to FCM: auto-init stays off until then, so a
   * device on UnifiedPush never registers with Google.
   */
  fun token(context: Context): String? {
    if (!isAvailable(context) || ensureApp(context) == null) return null
    return try {
      val messaging = FirebaseMessaging.getInstance()
      messaging.isAutoInitEnabled = true
      Tasks.await(messaging.token, TOKEN_TIMEOUT_S, TimeUnit.SECONDS)?.also { PushStore.get(context).fcmToken = it }
    } catch (e: Exception) {
      Log.w(TAG, "FCM token unavailable: ${e.message}")
      PushStore.get(context).fcmToken
    }
  }

  /**
   * Opts the device back out of FCM when push stops using it (the person switched to
   * UnifiedPush, or turned push off): auto-init off and the registration token deleted, so
   * Firebase stops renewing a token with Google that nothing uses. The next [token] call opts
   * in again. Blocking; call off the main thread.
   */
  fun release(context: Context) {
    PushStore.get(context).fcmToken = null
    if (!isConfigured(context) || FirebaseApp.getApps(context).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) return
    try {
      val messaging = FirebaseMessaging.getInstance()
      messaging.isAutoInitEnabled = false
      Tasks.await(messaging.deleteToken(), TOKEN_TIMEOUT_S, TimeUnit.SECONDS)
    } catch (e: Exception) {
      Log.w(TAG, "FCM token not deleted: ${e.message}")
    }
  }
}
