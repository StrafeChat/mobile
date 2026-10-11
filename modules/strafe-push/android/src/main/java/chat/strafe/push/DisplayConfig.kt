package chat.strafe.push

import org.json.JSONArray
import org.json.JSONObject

/**
 * Localized templates for the native renderer, already translated by JavaScript
 * (`setDisplayConfig`). The English defaults only matter before the app has run once.
 */
data class PushStrings(
  val appName: String = "Strafe",
  val newMessage: String = "New message",
  val encryptedMessage: String = "Encrypted message",
  val attachment: String = "Sent an attachment",
  val spaceRoom: String = "#{{room}} · {{space}}",
  val threadRoom: String = "{{thread}} · #{{room}}",
  val incomingCall: String = "Incoming call",
  val callFrom: String = "{{name}} is calling",
  val callFromIn: String = "{{name}} is calling {{room}}",
  val markRead: String = "Mark as read",
  val reply: String = "Reply",
  val answer: String = "Answer",
  val decline: String = "Decline",
  val testTitle: String = "Push notifications work",
  val testBody: String = "This is a test notification from your instance.",
  val channelMessages: String = "Messages",
  val channelMessagesSilent: String = "Messages (silent)",
  val channelCalls: String = "Incoming calls",
) {
  fun toJson(): JSONObject = JSONObject().apply {
    put("appName", appName)
    put("newMessage", newMessage)
    put("encryptedMessage", encryptedMessage)
    put("attachment", attachment)
    put("spaceRoom", spaceRoom)
    put("threadRoom", threadRoom)
    put("incomingCall", incomingCall)
    put("callFrom", callFrom)
    put("callFromIn", callFromIn)
    put("markRead", markRead)
    put("reply", reply)
    put("answer", answer)
    put("decline", decline)
    put("testTitle", testTitle)
    put("testBody", testBody)
    put("channelMessages", channelMessages)
    put("channelMessagesSilent", channelMessagesSilent)
    put("channelCalls", channelCalls)
  }

  companion object {
    fun fromJson(o: JSONObject?): PushStrings {
      val d = PushStrings()
      if (o == null) return d
      fun s(key: String, fallback: String) = o.optString(key).ifEmpty { fallback }
      return PushStrings(
        appName = s("appName", d.appName),
        newMessage = s("newMessage", d.newMessage),
        encryptedMessage = s("encryptedMessage", d.encryptedMessage),
        attachment = s("attachment", d.attachment),
        spaceRoom = s("spaceRoom", d.spaceRoom),
        threadRoom = s("threadRoom", d.threadRoom),
        incomingCall = s("incomingCall", d.incomingCall),
        callFrom = s("callFrom", d.callFrom),
        callFromIn = s("callFromIn", d.callFromIn),
        markRead = s("markRead", d.markRead),
        reply = s("reply", d.reply),
        answer = s("answer", d.answer),
        decline = s("decline", d.decline),
        testTitle = s("testTitle", d.testTitle),
        testBody = s("testBody", d.testBody),
        channelMessages = s("channelMessages", d.channelMessages),
        channelMessagesSilent = s("channelMessagesSilent", d.channelMessagesSilent),
        channelCalls = s("channelCalls", d.channelCalls),
      )
    }
  }
}

/** One signed-in account. Its session token is not here: that is stored encrypted, apart. */
data class DisplayAccount(val slot: String, val userId: String, val label: String, val apiBase: String)

/** What `setDisplayConfig` gave us, as persisted (minus tokens) for pushes that arrive while JS isn't running. */
data class DisplayConfig(
  val strings: PushStrings = PushStrings(),
  val accounts: List<DisplayAccount> = emptyList(),
  val activeSlot: String? = null,
  val preview: Boolean = true,
  val sounds: Boolean = true,
) {
  fun account(slot: String): DisplayAccount? = accounts.firstOrNull { it.slot == slot }

  /** The account label goes on notifications only when there is more than one account to tell apart. */
  val showsAccountLabel: Boolean get() = accounts.size > 1

  fun toJson(): JSONObject = JSONObject().apply {
    put("strings", strings.toJson())
    put(
      "accounts",
      JSONArray().apply {
        accounts.forEach {
          put(JSONObject().put("slot", it.slot).put("userId", it.userId).put("label", it.label).put("apiBase", it.apiBase))
        }
      },
    )
    put("activeSlot", activeSlot ?: JSONObject.NULL)
    put("preview", preview)
    put("sounds", sounds)
  }

  companion object {
    fun fromJson(o: JSONObject): DisplayConfig {
      val list = o.optJSONArray("accounts") ?: JSONArray()
      val accounts = (0 until list.length()).mapNotNull { i ->
        val a = list.optJSONObject(i) ?: return@mapNotNull null
        val slot = a.optString("slot")
        if (!Slots.isValid(slot)) return@mapNotNull null
        DisplayAccount(slot, a.optString("userId"), a.optString("label"), a.optString("apiBase").trimEnd('/'))
      }
      return DisplayConfig(
        strings = PushStrings.fromJson(o.optJSONObject("strings")),
        accounts = accounts,
        activeSlot = if (o.isNull("activeSlot")) null else o.optString("activeSlot").ifEmpty { null },
        preview = o.optBoolean("preview", true),
        sounds = o.optBoolean("sounds", true),
      )
    }
  }
}

object Slots {
  private val SLOT = Regex("^[A-Za-z0-9_-]{1,32}$")

  fun isValid(slot: String?): Boolean = slot != null && SLOT.matches(slot)
}
