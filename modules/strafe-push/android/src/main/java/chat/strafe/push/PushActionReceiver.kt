package chat.strafe.push

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * The notification actions that don't open the app: **Mark as read** (`POST /rooms/:id/ack`)
 * and **Decline** (`POST /rooms/:id/call/decline`), sent natively as the account the
 * notification belongs to. The notification goes away at once; the request follows.
 */
class PushActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val slot = intent.getStringExtra(EXTRA_SLOT)?.takeIf { Slots.isValid(it) } ?: return
    // Only our own PendingIntents reach this receiver, but the ids still become URL paths.
    val roomId = intent.getStringExtra(EXTRA_ROOM_ID)?.takeIf { PushContent.isSnowflake(it) } ?: return
    val config = PushStore.get(context).displayConfig()
    val notifier = PushNotifier(context)
    when (intent.action) {
      ACTION_MARK_READ -> {
        val messageId = intent.getStringExtra(EXTRA_MESSAGE_ID)?.takeIf { PushContent.isSnowflake(it) } ?: return
        notifier.clearRoom(slot, roomId, config)
        request(context, slot, "/rooms/$roomId/ack", JSONObject().put("last_read_message_id", messageId))
      }
      ACTION_DECLINE -> {
        notifier.cancelCall(slot, roomId)
        request(context, slot, "/rooms/$roomId/call/decline", null)
      }
    }
  }

  private fun request(context: Context, slot: String, path: String, body: JSONObject?) {
    val store = PushStore.get(context)
    val account = store.displayConfig().account(slot) ?: return
    val token = store.token(slot) ?: return
    val pending = goAsync()
    executor.execute {
      try {
        if (!PushHttp.post(account.apiBase, path, token, body)) Log.w(TAG, "notification action failed")
      } catch (e: RuntimeException) {
        Log.w(TAG, "notification action failed: ${e.javaClass.simpleName}")
      } finally {
        pending.finish()
      }
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
