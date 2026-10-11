package chat.strafe.push

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Bundle
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Draws Strafe's notifications natively: one MessagingStyle conversation per room (a new
 * message is appended to the room's existing notification, so they stack), grouped per
 * account under a summary; incoming calls on their own ringing channel; the test push.
 *
 * Every notification is tagged `strafe:<slot>:…` with a fixed id per kind, which is how a
 * later push (read, call_end), an action, or the app (clearRoom/clearAll) finds it again.
 */
internal class PushNotifier(context: Context) {
  private val context = context.applicationContext
  private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private val smallIcon: Int by lazy {
    // expo-notifications' generated icon if the app config ever sets one, else the adaptive
    // icon's monochrome layer (a silhouette, as a status-bar icon must be), else the app
    // icon, else a platform glyph - Android refuses a notification without a valid icon.
    resource("notification_icon", "drawable")
      ?: resource("ic_launcher_monochrome", "mipmap")
      ?: context.applicationInfo.icon.takeIf { it != 0 }
      ?: android.R.drawable.stat_notify_chat
  }

  private val accentColor: Int? by lazy {
    resource("notification_icon_color", "color")?.let { ContextCompat.getColor(context, it) }
  }

  /** Creates the channels if missing; re-creating one only updates its name (to the current language). */
  fun ensureChannels(strings: PushStrings) {
    // Same ids and behaviour as the JavaScript local notifications (src/platform/notifications.ts),
    // so a push and an in-app notification land in the same place in the system settings.
    val messages = NotificationChannel(CHANNEL_MESSAGES, strings.channelMessages, NotificationManager.IMPORTANCE_HIGH).apply {
      vibrationPattern = MESSAGE_VIBRATION
      enableVibration(true)
    }
    val silent = NotificationChannel(CHANNEL_MESSAGES_SILENT, strings.channelMessagesSilent, NotificationManager.IMPORTANCE_HIGH).apply {
      setSound(null, null)
      vibrationPattern = MESSAGE_VIBRATION
      enableVibration(true)
    }
    val calls = NotificationChannel(CHANNEL_CALLS, strings.channelCalls, NotificationManager.IMPORTANCE_HIGH).apply {
      setSound(
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
      )
      vibrationPattern = CALL_VIBRATION
      enableVibration(true)
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    }
    manager.createNotificationChannels(listOf(messages, silent, calls))
  }

  // --- messages ---

  fun showMessage(slot: String, account: DisplayAccount, config: DisplayConfig, p: PushPayload) {
    val roomId = p.roomId ?: return
    val author = p.author ?: return
    val tag = PushContent.roomTag(slot, roomId)
    val style = active(tag, ID_MESSAGE)?.let { NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(it.notification) }
      ?: NotificationCompat.MessagingStyle(self(account, config.strings))
    // The same message twice (a push service redelivering, or the instance retrying a job a
    // restart cut short) is still one message: don't stack it again or ring a second time.
    if (style.messages.any { it.extras.getString(EXTRA_MESSAGE_ID) == p.messageId }) return
    style.setConversationTitle(PushContent.conversationTitle(p, config.strings))
    style.setGroupConversation(p.roomType != PushPayload.ROOM_PM)

    val sender = Person.Builder()
      .setKey("user:${author.id}")
      .setName(author.name)
      .apply { avatar(author.avatar, account)?.let { setIcon(IconCompat.createWithBitmap(it)) } }
      .build()
    val text = PushContent.messageText(p, config.strings, config.preview)
    val message = NotificationCompat.MessagingStyle.Message(text, p.timestamp.takeIf { it > 0 } ?: System.currentTimeMillis(), sender)
    message.extras.putString(EXTRA_MESSAGE_ID, p.messageId)
    style.addMessage(message)

    val room = RoomMeta(slot, roomId, p.roomType, p.spaceId, p.messageId)
    post(tag, ID_MESSAGE, buildMessage(room, account, config, style, alert = true))
    refreshSummary(slot, config, posted = tag)
  }

  /**
   * The room was read up to [readMessageId] elsewhere: drop what has been read. Messages that
   * arrived after that point stay (rare, but a read push can overtake a message push).
   */
  fun applyRead(slot: String, roomId: String, readMessageId: String, config: DisplayConfig) {
    val tag = PushContent.roomTag(slot, roomId)
    val existing = active(tag, ID_MESSAGE) ?: return
    val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(existing.notification)
    val account = config.account(slot)
    val unread = style?.messages?.filter { PushContent.isAfter(it.extras.getString(EXTRA_MESSAGE_ID), readMessageId) }.orEmpty()
    if (style == null || account == null || unread.isEmpty()) {
      manager.cancel(tag, ID_MESSAGE)
      refreshSummary(slot, config, removed = tag)
    } else {
      val rebuilt = NotificationCompat.MessagingStyle(style.user)
        .setConversationTitle(style.conversationTitle)
        .setGroupConversation(style.isGroupConversation)
      unread.forEach { rebuilt.addMessage(it) }
      val extras = existing.notification.extras
      val room = RoomMeta(
        slot,
        roomId,
        extras.getInt(EXTRA_ROOM_TYPE),
        extras.getString(EXTRA_SPACE_ID),
        unread.last().extras.getString(EXTRA_MESSAGE_ID),
      )
      post(tag, ID_MESSAGE, buildMessage(room, account, config, rebuilt, alert = false))
    }
  }

  private fun buildMessage(
    room: RoomMeta,
    account: DisplayAccount,
    config: DisplayConfig,
    style: NotificationCompat.MessagingStyle,
    alert: Boolean,
  ): Notification {
    val s = config.strings
    val channel = if (config.sounds) CHANNEL_MESSAGES else CHANNEL_MESSAGES_SILENT
    val tag = PushContent.roomTag(room.slot, room.roomId)
    val builder = NotificationCompat.Builder(context, channel)
      .setSmallIcon(smallIcon)
      .setStyle(style)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setGroup(PushContent.group(room.slot))
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion(channel, s.appName, s.newMessage))
      .setShowWhen(true)
      .setOnlyAlertOnce(!alert)
      .setSilent(!alert)
      .addExtras(room.toExtras())
      .setContentIntent(
        activity(PushContent.deepLink(room.slot, room.roomId, room.spaceId, room.messageId, key = linkKey), "$tag:open"),
      )
    accentColor?.let { builder.setColor(it) }
    if (config.showsAccountLabel) builder.setSubText(account.label)

    // Mark as read runs in the background with the account's token; without one it can't.
    if (room.messageId != null && PushStore.get(context).token(room.slot) != null) {
      builder.addAction(
        NotificationCompat.Action.Builder(0, s.markRead, PushActionReceiver.markRead(context, room.slot, room.roomId, room.messageId))
          .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
          .setShowsUserInterface(false)
          .build(),
      )
    }
    builder.addAction(
      NotificationCompat.Action.Builder(
        0,
        s.reply,
        activity(PushContent.deepLink(room.slot, room.roomId, room.spaceId, room.messageId, reply = true, key = linkKey), "$tag:reply"),
      ).build(),
    )
    return builder.build()
  }

  // --- calls ---

  fun showCall(slot: String, account: DisplayAccount, config: DisplayConfig, p: PushPayload) {
    val roomId = p.roomId ?: return
    val s = config.strings
    val tag = PushContent.callTag(slot, roomId)
    val builder = NotificationCompat.Builder(context, CHANNEL_CALLS)
      .setSmallIcon(smallIcon)
      .setContentTitle(s.incomingCall)
      .setContentText(PushContent.callText(p, s))
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setOngoing(true)
      .setAutoCancel(false)
      // Ringing stops server-side after this long too; a missed call_end can't leave it ringing.
      .setTimeoutAfter(CALL_TIMEOUT_MS)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion(CHANNEL_CALLS, s.appName, s.incomingCall))
      .setContentIntent(activity(PushContent.deepLink(slot, roomId, p.spaceId, key = linkKey), "$tag:open"))
      .addAction(
        NotificationCompat.Action.Builder(0, s.decline, PushActionReceiver.decline(context, slot, roomId))
          .setShowsUserInterface(false)
          .build(),
      )
      .addAction(
        NotificationCompat.Action.Builder(0, s.answer, activity(PushContent.deepLink(slot, roomId, p.spaceId, answer = true, key = linkKey), "$tag:answer"))
          .build(),
      )
    // `when` is the ring's start: Android drops a notification whose when + timeout has
    // already passed, so a call push delivered too late to matter never rings.
    if (p.timestamp > 0) builder.setWhen(p.timestamp).setShowWhen(true)
    avatar(p.author?.avatar, account)?.let { builder.setLargeIcon(it) }
    accentColor?.let { builder.setColor(it) }
    if (config.showsAccountLabel) builder.setSubText(account.label)
    // Ring like a phone until answered, declined or timed out, not one chime.
    val notification = builder.build().apply { flags = flags or Notification.FLAG_INSISTENT }
    post(tag, ID_CALL, notification)
  }

  fun cancelCall(slot: String, roomId: String) {
    manager.cancel(PushContent.callTag(slot, roomId), ID_CALL)
  }

  // --- test ---

  fun showTest(slot: String, account: DisplayAccount, config: DisplayConfig) {
    val s = config.strings
    val channel = if (config.sounds) CHANNEL_MESSAGES else CHANNEL_MESSAGES_SILENT
    val tag = PushContent.testTag(slot)
    val builder = NotificationCompat.Builder(context, channel)
      .setSmallIcon(smallIcon)
      .setContentTitle(s.testTitle)
      .setContentText(s.testBody)
      .setStyle(NotificationCompat.BigTextStyle().bigText(s.testBody))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setContentIntent(activity(PushContent.deepLink(slot, null, key = linkKey), "$tag:open"))
    accentColor?.let { builder.setColor(it) }
    if (config.showsAccountLabel) builder.setSubText(account.label)
    post(tag, ID_TEST, builder.build())
  }

  // --- clearing ---

  /** Removes one room's message and call notifications. */
  fun clearRoom(slot: String, roomId: String, config: DisplayConfig) {
    val tag = PushContent.roomTag(slot, roomId)
    manager.cancel(tag, ID_MESSAGE)
    manager.cancel(PushContent.callTag(slot, roomId), ID_CALL)
    refreshSummary(slot, config, removed = tag)
  }

  /** Removes every notification of [slot], or every Strafe push notification when null. */
  fun clearAll(slot: String?) {
    val prefix = PushContent.slotPrefix(slot)
    activeNotifications().filter { it.tag?.startsWith(prefix) == true }.forEach { manager.cancel(it.tag, it.id) }
  }

  /**
   * Posts, updates or removes the account's group summary to match its conversations. The
   * system applies notify/cancel asynchronously, so the caller names the room notification it
   * has just [posted] or [removed] rather than trusting the active list to show it yet.
   */
  private fun refreshSummary(slot: String, config: DisplayConfig, posted: String? = null, removed: String? = null) {
    val group = PushContent.group(slot)
    val summaryTag = PushContent.summaryTag(slot)
    val children = activeNotifications()
      .filter { it.notification.group == group && it.tag != summaryTag }
      .mapNotNull { it.tag }
      .toSet()
      .plus(listOfNotNull(posted))
      .minus(listOfNotNull(removed).toSet())
    if (children.isEmpty()) {
      manager.cancel(summaryTag, ID_SUMMARY)
      return
    }
    val s = config.strings
    val channel = if (config.sounds) CHANNEL_MESSAGES else CHANNEL_MESSAGES_SILENT
    val builder = NotificationCompat.Builder(context, channel)
      .setSmallIcon(smallIcon)
      .setContentTitle(s.appName)
      .setContentText(s.newMessage)
      .setGroup(group)
      .setGroupSummary(true)
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setSilent(true)
      .setAutoCancel(true)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion(channel, s.appName, s.newMessage))
      .setContentIntent(activity(PushContent.deepLink(slot, null, key = linkKey), "$summaryTag:open"))
    accentColor?.let { builder.setColor(it) }
    config.account(slot)?.takeIf { config.showsAccountLabel }?.let { builder.setSubText(it.label) }
    post(summaryTag, ID_SUMMARY, builder.build())
  }

  // --- helpers ---

  /** Our notifications' link key (see [PushContent.deepLink]). */
  private val linkKey: String by lazy { PushStore.get(context).linkKey() }

  /** The author's avatar, when the URL is one the device may fetch ([PushContent.avatarAllowed]). */
  private fun avatar(url: String?, account: DisplayAccount): android.graphics.Bitmap? =
    if (PushContent.avatarAllowed(url, account.apiBase)) PushHttp.avatar(url) else null

  private fun self(account: DisplayAccount, strings: PushStrings): Person =
    Person.Builder().setKey("self:${account.slot}").setName(account.label.ifEmpty { strings.appName }).build()

  /** What the lock screen shows instead of the real notification while the device is locked. */
  private fun publicVersion(channel: String, title: String, text: String): Notification =
    NotificationCompat.Builder(context, channel)
      .setSmallIcon(smallIcon)
      .setContentTitle(title)
      .setContentText(text)
      .apply { accentColor?.let { setColor(it) } }
      .build()

  private fun activity(uri: String, key: String): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, key.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun post(tag: String, id: Int, notification: Notification) {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
    try {
      manager.notify(tag, id, notification)
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS revoked between the check and here.
      Log.w(TAG, "notification not allowed", e)
    }
  }

  private fun active(tag: String, id: Int): StatusBarNotification? = activeNotifications().firstOrNull { it.tag == tag && it.id == id }

  private fun activeNotifications(): List<StatusBarNotification> =
    try {
      manager.activeNotifications.toList()
    } catch (e: RuntimeException) {
      emptyList()
    }

  private fun resource(name: String, type: String): Int? =
    context.resources.getIdentifier(name, type, context.packageName).takeIf { it != 0 }

  /** What a room notification remembers about its room, for rebuilding it on a read. */
  private data class RoomMeta(val slot: String, val roomId: String, val roomType: Int, val spaceId: String?, val messageId: String?) {
    fun toExtras() = Bundle().apply {
      putString(EXTRA_SLOT, slot)
      putString(EXTRA_ROOM_ID, roomId)
      putInt(EXTRA_ROOM_TYPE, roomType)
      spaceId?.let { putString(EXTRA_SPACE_ID, it) }
      messageId?.let { putString(EXTRA_MESSAGE_ID, it) }
    }
  }

  companion object {
    private const val TAG = "StrafePush"

    const val CHANNEL_MESSAGES = "messages"
    const val CHANNEL_MESSAGES_SILENT = "messages-silent"
    const val CHANNEL_CALLS = "calls-incoming"

    const val ID_SUMMARY = 0
    const val ID_MESSAGE = 1
    const val ID_CALL = 2
    const val ID_TEST = 3

    private const val CALL_TIMEOUT_MS = 45_000L
    private val MESSAGE_VIBRATION = longArrayOf(0, 120, 60, 120)
    private val CALL_VIBRATION = longArrayOf(0, 800, 600, 800, 600)

    private const val EXTRA_SLOT = "strafe.slot"
    private const val EXTRA_ROOM_ID = "strafe.rid"
    private const val EXTRA_ROOM_TYPE = "strafe.rt"
    private const val EXTRA_SPACE_ID = "strafe.sid"
    private const val EXTRA_MESSAGE_ID = "strafe.mid"
  }
}
