package chat.strafe.push

import java.net.InetAddress
import java.net.URI
import java.net.URLEncoder

/**
 * What a push says, decided apart from how Android draws it (so it is unit-tested on the
 * JVM). The instance sends structure; the words come from the person's language through
 * [PushStrings].
 */
object PushContent {
  /** Fills `{{name}}` placeholders; unknown placeholders are left as they are. */
  fun fill(template: String, vararg values: Pair<String, String>): String {
    var out = template
    for ((key, value) in values) out = out.replace("{{$key}}", value)
    return out
  }

  /**
   * The conversation title: none for a 1:1 PM (the sender's name is the conversation), the
   * group PM's name, `#room · space` for a space room, `thread · #room` for a thread.
   */
  fun conversationTitle(p: PushPayload, s: PushStrings): String? = when (p.roomType) {
    PushPayload.ROOM_PM -> null
    PushPayload.ROOM_GROUP_PM -> p.roomName
    PushPayload.ROOM_THREAD -> fill(s.threadRoom, "thread" to (p.roomName ?: ""), "room" to (p.parentName ?: ""))
    else -> fill(s.spaceRoom, "room" to (p.roomName ?: ""), "space" to (p.spaceName ?: ""))
  }

  /** The message line: the preview when there is one and previews are on, else what kind of message it was. */
  fun messageText(p: PushPayload, s: PushStrings, preview: Boolean): String = when {
    preview && !p.encrypted && !p.body.isNullOrEmpty() -> p.body
    p.encrypted -> s.encryptedMessage
    p.attachments > 0 -> s.attachment
    else -> s.newMessage
  }

  /** `Alice is calling`, or `Alice is calling Weekend plans` for a named group PM. */
  fun callText(p: PushPayload, s: PushStrings): String {
    val name = p.author?.name ?: ""
    val room = p.roomName
    return if (p.roomType != PushPayload.ROOM_PM && !room.isNullOrEmpty()) {
      fill(s.callFromIn, "name" to name, "room" to room)
    } else {
      fill(s.callFrom, "name" to name)
    }
  }

  /**
   * `strafe://push/open?slot=…&rid=…[&sid=…][&mid=…][&reply=1|&answer=1][&k=…]`, routed by the
   * app's +native-intent.
   *
   * Any app or web page can open a `strafe://` link, so the app only acts on Reply / Answer
   * when the link carries [key] - this install's link key ([PushStore.linkKey]), which only
   * our own notifications know. Without it a link can open a room, never join a call.
   */
  fun deepLink(
    slot: String,
    roomId: String?,
    spaceId: String? = null,
    messageId: String? = null,
    reply: Boolean = false,
    answer: Boolean = false,
    key: String? = null,
  ): String {
    val query = buildList {
      add("slot" to slot)
      roomId?.let { add("rid" to it) }
      spaceId?.let { add("sid" to it) }
      messageId?.let { add("mid" to it) }
      if (reply) add("reply" to "1")
      if (answer) add("answer" to "1")
      key?.let { add("k" to it) }
    }.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
    return "strafe://push/open?$query"
  }

  private val SNOWFLAKE = Regex("^[0-9]{1,20}$")

  /** An id as the instance writes them: a snowflake, digits only. */
  fun isSnowflake(id: String?): Boolean = id != null && SNOWFLAKE.matches(id)

  /**
   * Whether the renderer may fetch an author's avatar from [url]. The device fetches it on
   * its own network, so a URL that names this network (a router's admin page, a LAN service)
   * must not be fetched just because a push said so - a federated author's avatar comes from
   * their instance, not ours. Allowed: anything on the account's own instance host (which may
   * be plain http or a private address in development), else https to a name or a public
   * address.
   */
  fun avatarAllowed(url: String?, apiBase: String?): Boolean {
    val uri = try {
      URI(url ?: return false)
    } catch (e: Exception) {
      return false
    }
    val host = uri.host?.lowercase()?.removeSurrounding("[", "]") ?: return false
    if (uri.userInfo != null) return false
    val ownHost = try {
      apiBase?.let { URI(it).host?.lowercase()?.removeSurrounding("[", "]") }
    } catch (e: Exception) {
      null
    }
    if (host == ownHost && (uri.scheme == "https" || uri.scheme == "http")) return true
    if (uri.scheme != "https") return false
    if (host == "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false
    return !isNonPublicLiteral(host)
  }

  private val IPV4_LITERAL = Regex("^[0-9]{1,3}(\\.[0-9]{1,3}){3}$")

  private fun isNonPublicLiteral(host: String): Boolean {
    if (!IPV4_LITERAL.matches(host) && !host.contains(':')) return false
    // A literal: InetAddress parses it without any DNS lookup.
    val address = try {
      InetAddress.getByName(host)
    } catch (e: Exception) {
      return true
    }
    val bytes = address.address
    val uniqueLocal = bytes.size == 16 && (bytes[0].toInt() and 0xfe) == 0xfc
    val cgnat = bytes.size == 4 && (bytes[0].toInt() and 0xff) == 100 && (bytes[1].toInt() and 0xc0) == 64
    return address.isLoopbackAddress || address.isSiteLocalAddress || address.isLinkLocalAddress ||
      address.isAnyLocalAddress || address.isMulticastAddress || uniqueLocal || cgnat
  }

  /** Snowflake order: true when [id] is later than [other]. Unparseable ids are never "later". */
  fun isAfter(id: String?, other: String?): Boolean {
    val a = id?.toBigIntegerOrNull() ?: return false
    val b = other?.toBigIntegerOrNull() ?: return true
    return a > b
  }

  /** Notification tags, which is how a later push (read, call_end) or the app finds them again. */
  fun roomTag(slot: String, roomId: String) = "strafe:$slot:room:$roomId"

  fun callTag(slot: String, roomId: String) = "strafe:$slot:call:$roomId"

  fun testTag(slot: String) = "strafe:$slot:test"

  fun summaryTag(slot: String) = "strafe:$slot:summary"

  fun group(slot: String) = "strafe:$slot"

  fun slotPrefix(slot: String?) = if (slot == null) "strafe:" else "strafe:$slot:"
}
