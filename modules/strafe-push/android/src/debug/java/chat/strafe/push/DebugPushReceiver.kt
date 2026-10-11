package chat.strafe.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.concurrent.Executors

/**
 * Debug builds only (src/debug): runs a push through exactly the path an FCM data message
 * takes - extras `s` (slot) and `p` (base64url aes128gcm body), as the push gateway's debug
 * transport lists them - so the whole chain can be tested on an emulator without Google.
 */
class DebugPushReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val slot = intent.getStringExtra("s")
    val body = intent.getStringExtra("p")
    val pending = goAsync()
    executor.execute {
      try {
        PushHandler.handleEncoded(context.applicationContext, slot, body)
      } finally {
        pending.finish()
      }
    }
  }

  private companion object {
    val executor = Executors.newSingleThreadExecutor()
  }
}
