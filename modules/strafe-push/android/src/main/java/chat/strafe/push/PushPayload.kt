package chat.strafe.push

import org.json.JSONException
import org.json.JSONObject

/** The sender of a message or the caller of a call. */
data class PushAuthor(val id: String, val name: String, val avatar: String?)

/**
 * The plaintext inside a push (docs/PUSH.md, "Payload"). Field names on the wire are short
 * for the size budget; here they are spelled out. Ids stay snowflake strings.
 */
data class PushPayload(
  val type: String,
  val userId: String,
  val timestamp: Long,
  val roomId: String? = null,
  val roomType: Int = 0,
  val spaceId: String? = null,
  val messageId: String? = null,
  val author: PushAuthor? = null,
  val roomName: String? = null,
  val parentName: String? = null,
  val spaceName: String? = null,
  val encrypted: Boolean = false,
  val body: String? = null,
  val attachments: Int = 0,
  val mentioned: Boolean = false,
) {
  companion object {
    const val TYPE_MESSAGE = "msg"
    const val TYPE_READ = "read"
    const val TYPE_CALL = "call"
    const val TYPE_CALL_END = "call_end"
    const val TYPE_TEST = "test"

    const val ROOM_PM = 1
    const val ROOM_GROUP_PM = 2
    const val ROOM_SPACE_TEXT = 3
    const val ROOM_SPACE_VOICE = 4
    const val ROOM_THREAD = 6

    private const val VERSION = 1
    private val ID = Regex("^[0-9]{1,20}$")
    private const val MAX_TEXT = 1000

    /**
     * Parses a decrypted payload. Null for anything this version doesn't understand - an
     * unknown `v` or `t`, a missing required field, an id that isn't a snowflake - which the
     * device then ignores silently, as the contract says.
     */
    fun parse(json: String): PushPayload? {
      val o = try {
        JSONObject(json)
      } catch (e: JSONException) {
        return null
      }
      if (o.optInt("v", -1) != VERSION) return null
      val type = o.optString("t")
      val userId = o.id("uid") ?: return null
      val ts = o.optLong("ts", 0L)
      if (type == TYPE_TEST) return PushPayload(type, userId, ts)
      if (type !in setOf(TYPE_MESSAGE, TYPE_READ, TYPE_CALL, TYPE_CALL_END)) return null

      val roomId = o.id("rid") ?: return null
      val roomType = o.optInt("rt", 0)
      if (roomType !in setOf(ROOM_PM, ROOM_GROUP_PM, ROOM_SPACE_TEXT, ROOM_SPACE_VOICE, ROOM_THREAD)) return null
      val spaceId = if (o.has("sid")) o.id("sid") ?: return null else null
      val messageId = if (o.has("mid")) o.id("mid") ?: return null else null
      val author = o.optJSONObject("a")?.let { a ->
        val id = a.id("id") ?: return null
        val name = a.text("n") ?: return null
        PushAuthor(id, name, a.text("av"))
      }
      when (type) {
        TYPE_MESSAGE -> if (messageId == null || author == null) return null
        TYPE_READ -> if (messageId == null) return null
        TYPE_CALL -> if (author == null) return null
      }
      return PushPayload(
        type = type,
        userId = userId,
        timestamp = ts,
        roomId = roomId,
        roomType = roomType,
        spaceId = spaceId,
        messageId = messageId,
        author = author,
        roomName = o.text("rn"),
        parentName = o.text("pn"),
        spaceName = o.text("sn"),
        encrypted = o.optBoolean("e", false),
        // Never trust a body in an E2EE room: the server shouldn't have one to send.
        body = if (o.optBoolean("e", false)) null else o.text("b"),
        attachments = o.optInt("att", 0).coerceAtLeast(0),
        mentioned = o.optBoolean("m", false),
      )
    }

    private fun JSONObject.id(key: String): String? = (opt(key) as? String)?.takeIf { ID.matches(it) }

    private fun JSONObject.text(key: String): String? =
      (opt(key) as? String)?.trim()?.takeIf { it.isNotEmpty() }?.let { if (it.length > MAX_TEXT) it.take(MAX_TEXT) else it }
  }
}
