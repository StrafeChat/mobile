package chat.strafe.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * The app's only FCM receiver. The push gateway forwards each Web Push as a data-only
 * message `{s: slot, p: base64url aes128gcm body}`; Google only ever sees that ciphertext.
 * Called on a background thread, so decrypting and rendering happen right here.
 */
class StrafeFirebaseMessagingService : FirebaseMessagingService() {
  override fun onCreate() {
    // StrafePushPackage initialises Firebase with the application; this covers any path
    // where the service starts first.
    Fcm.ensureApp(applicationContext)
    super.onCreate()
  }

  override fun onMessageReceived(message: RemoteMessage) {
    PushHandler.handleEncoded(applicationContext, message.data["s"], message.data["p"])
  }

  override fun onNewToken(token: String) {
    PushStore.get(applicationContext).fcmToken = token
    PushEvents.emit(PushEvents.FCM_TOKEN, mapOf("token" to token))
  }
}
