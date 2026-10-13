package chat.strafe.push

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import org.json.JSONObject
import java.security.GeneralSecurityException
import java.util.concurrent.Executors

/**
 * The notification actions that don't open the app: **Mark as read** (`POST /rooms/:id/ack`)
 * and **Decline** (`POST /rooms/:id/call/decline`), sent natively as the account the
 * notification belongs to. The notification goes away at once; the request follows.
 *
 * This runs on the main thread, where anything uncaught kills the process - the open app
 * included, when the button is pressed with Strafe on screen. So the keystore (the session
 * token is sealed with it) is only touched on the background thread, and every step is
 * guarded: a failed action is logged by type and dropped.
 */
class PushActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val slot = intent.getStringExtra(EXTRA_SLOT)?.takeIf { Slots.isValid(it) } ?: return
    // Only our own PendingIntents reach this receiver, but the ids still become URL paths.
    val roomId = intent.getStringExtra(EXTRA_ROOM_ID)?.takeIf { PushContent.isSnowflake(it) } ?: return
    when (intent.action) {
      ACTION_MARK_READ -> {
        val messageId = intent.getStringExtra(EXTRA_MESSAGE_ID)?.takeIf { PushContent.isSnowflake(it) } ?: return
        guarded { PushNotifier(context).clearRoom(slot, roomId, PushStore.get(context).displayConfig()) }
        request(context, slot, "/rooms/$roomId/ack", JSONObject().put("last_read_message_id", messageId))
      }
      ACTION_DECLINE -> {
        guarded { PushNotifier(context).cancelCall(slot, roomId) }
        request(context, slot, "/rooms/$roomId/call/decline", null)
      }
    }
  }

  private fun request(context: Context, slot: String, path: String, body: JSONObject?) {
    val pending = goAsync()
    executor.execute {
      try {
        guarded {
          val store = PushStore.get(context)
          val account = store.displayConfig().account(slot) ?: return@guarded
          val token = store.token(slot) ?: return@guarded
          if (!PushHttp.post(account.apiBase, path, token, body)) Log.w(TAG, "notification action failed")
        }
      } finally {
        pending.finish()
      }
    }
  }

  private inline fun guarded(block: () -> Unit) {
    try {
      block()
    } catch (e: RuntimeException) {
      Log.w(TAG, "notification action failed: ${e.javaClass.simpleName}")
    } catch (e: GeneralSecurityException) {
      Log.w(TAG, "notification action failed: ${e.javaClass.simpleName}")
    }
  }

  companion object {
    private const val TAG = "StrafePush"
    private const val ACTION_MARK_READ = "chat.strafe.push.MARK_READ"
    private const val ACTION_DECLINE = "chat.strafe.push.DECLINE"
    private const val EXTRA_SLOT = "slot"
    private const val EXTRA_ROOM_ID = "rid"
    private const val EXTRA_MESSAGE_ID = "mid"

    private val executor = Executors.newSingleThreadExecutor()

    fun markRead(context: Context, slot: String, roomId: String, messageId: String): PendingIntent =
      pending(context, ACTION_MARK_READ, slot, roomId, messageId)

    fun decline(context: Context, slot: String, roomId: String): PendingIntent =
      pending(context, ACTION_DECLINE, slot, roomId, null)

    private fun pending(context: Context, action: String, slot: String, roomId: String, messageId: String?): PendingIntent {
      val intent = Intent(context, PushActionReceiver::class.java)
        .setAction(action)
        // The data makes each (action, account, room) its own PendingIntent: the system
        // matches PendingIntents by action, data and component - not extras - so with only a
        // request code to tell them apart, two rooms whose codes collide would share one and
        // Mark as read on one would read the other.
        .setData(Uri.parse("strafe-push-action://$action/$slot/$roomId"))
        .putExtra(EXTRA_SLOT, slot)
        .putExtra(EXTRA_ROOM_ID, roomId)
        .apply { messageId?.let { putExtra(EXTRA_MESSAGE_ID, it) } }
      // One PendingIntent per room and action; UPDATE_CURRENT keeps "read up to" at the newest message.
      return PendingIntent.getBroadcast(
        context,
        "$action:$slot:$roomId".hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
