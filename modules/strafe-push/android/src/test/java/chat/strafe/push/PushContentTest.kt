package chat.strafe.push

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PushContentTest {
  private val s = PushStrings()
  private val alice = PushAuthor("4", "Alice", null)

  private fun msg(rt: Int, vararg extra: Pair<String, Any?>): PushPayload {
    val base = PushPayload(type = "msg", userId = "1", timestamp = 1, roomId = "2", roomType = rt, messageId = "3", author = alice)
    var p = base
    for ((k, v) in extra) {
      p = when (k) {
        "rn" -> p.copy(roomName = v as String)
        "pn" -> p.copy(parentName = v as String)
        "sn" -> p.copy(spaceName = v as String)
        "b" -> p.copy(body = v as String)
        "e" -> p.copy(encrypted = v as Boolean)
        "att" -> p.copy(attachments = v as Int)
        else -> p
      }
    }
    return p
  }

  @Test
  fun titlesEachKindOfRoom() {
    assertNull(PushContent.conversationTitle(msg(1), s))
    assertEquals("Weekend plans", PushContent.conversationTitle(msg(2, "rn" to "Weekend plans"), s))
    assertEquals("#general · Strafe HQ", PushContent.conversationTitle(msg(3, "rn" to "general", "sn" to "Strafe HQ"), s))
    assertEquals("#lounge · Strafe HQ", PushContent.conversationTitle(msg(4, "rn" to "lounge", "sn" to "Strafe HQ"), s))
    assertEquals("Release · #announcements", PushContent.conversationTitle(msg(6, "rn" to "Release", "pn" to "announcements"), s))
  }

  @Test
  fun picksTheMessageLine() {
    assertEquals("hey", PushContent.messageText(msg(3, "b" to "hey"), s, preview = true))
    assertEquals(s.newMessage, PushContent.messageText(msg(3, "b" to "hey"), s, preview = false))
    assertEquals(s.encryptedMessage, PushContent.messageText(msg(1, "e" to true), s, preview = true))
    assertEquals(s.attachment, PushContent.messageText(msg(3, "att" to 2), s, preview = true))
    assertEquals(s.attachment, PushContent.messageText(msg(3, "att" to 1, "b" to "x"), s, preview = false))
    assertEquals(s.newMessage, PushContent.messageText(msg(3), s, preview = true))
  }

  @Test
  fun saysWhoIsCalling() {
    val call = PushPayload(type = "call", userId = "1", timestamp = 1, roomId = "2", roomType = 1, author = alice)
    assertEquals("Alice is calling", PushContent.callText(call, s))
    assertEquals("Alice is calling Weekend plans", PushContent.callText(call.copy(roomType = 2, roomName = "Weekend plans"), s))
    assertEquals("Alice is calling", PushContent.callText(call.copy(roomType = 2), s))
  }

  @Test
  fun buildsDeepLinks() {
    assertEquals("strafe://push/open?slot=a_1&rid=2", PushContent.deepLink("a_1", "2"))
    assertEquals("strafe://push/open?slot=a&rid=2&sid=9&mid=3&reply=1", PushContent.deepLink("a", "2", "9", "3", reply = true))
    assertEquals("strafe://push/open?slot=a&rid=2&answer=1", PushContent.deepLink("a", "2", answer = true))
    assertEquals("strafe://push/open?slot=a", PushContent.deepLink("a", null))
    // The install's link key travels with our own links, last, URL-encoded.
    assertEquals(
      "strafe://push/open?slot=a&rid=2&answer=1&k=Ab-_9",
      PushContent.deepLink("a", "2", answer = true, key = "Ab-_9"),
    )
  }

  @Test
  fun checksSnowflakes() {
    assertTrue(PushContent.isSnowflake("1234567890123456789"))
    assertFalse(PushContent.isSnowflake(null))
    assertFalse(PushContent.isSnowflake(""))
    assertFalse(PushContent.isSnowflake("12/../ack"))
    assertFalse(PushContent.isSnowflake("1".repeat(21)))
  }

  @Test
  fun avatarsOnlyFromWhereTheDeviceMayFetch() {
    val api = "https://chat.example.org/api"
    assertTrue(PushContent.avatarAllowed("https://cdn.example.org/v1/avatars/1/a.webp", api))
    assertTrue(PushContent.avatarAllowed("https://cdn.remote.example/v1/a.webp", api))
    assertTrue(PushContent.avatarAllowed("https://8.8.8.8/a.webp", api))
    // The account's own instance host, whatever it is (development: http, a private address).
    assertTrue(PushContent.avatarAllowed("http://10.0.2.2:4100/v1/a.webp", "http://10.0.2.2:4000"))
    assertTrue(PushContent.avatarAllowed("https://chat.example.org/v1/a.webp", api))
    // Anything else: https to a public place only - never the device's own network.
    assertFalse(PushContent.avatarAllowed("http://cdn.remote.example/a.webp", api))
    assertFalse(PushContent.avatarAllowed("https://192.168.1.1/a.webp", api))
    assertFalse(PushContent.avatarAllowed("https://127.0.0.1/a.webp", api))
    assertFalse(PushContent.avatarAllowed("https://[fd00::1]/a.webp", api))
    assertFalse(PushContent.avatarAllowed("https://[::ffff:10.0.0.1]/a.webp", api))
    assertFalse(PushContent.avatarAllowed("https://169.254.169.254/a.webp", api))
    assertFalse(PushContent.avatarAllowed("https://100.64.1.1/a.webp", api))
    assertFalse(PushContent.avatarAllowed("https://router.local/a.webp", api))
    assertFalse(PushContent.avatarAllowed("https://user:pw@cdn.remote.example/a.webp", api))
    assertFalse(PushContent.avatarAllowed("file:///data/a.webp", api))
    assertFalse(PushContent.avatarAllowed(null, api))
    assertFalse(PushContent.avatarAllowed("not a url", api))
  }

  @Test
  fun comparesSnowflakes() {
    assertTrue(PushContent.isAfter("1234567890123456790", "1234567890123456789"))
    assertFalse(PushContent.isAfter("1234567890123456789", "1234567890123456789"))
    assertFalse(PushContent.isAfter("99", "100"))
    assertFalse(PushContent.isAfter(null, "1"))
  }

  @Test
  fun fillsTemplatesAndKeepsUnknownPlaceholders() {
    assertEquals("Bob is calling {{room}}", PushContent.fill("{{name}} is calling {{room}}", "name" to "Bob"))
  }

  @Test
  fun displayConfigSurvivesPersistence() {
    val config = DisplayConfig(
      strings = PushStrings(appName = "Strafe!", callFrom = "{{name}} ruft an"),
      accounts = listOf(DisplayAccount("a", "1", "@alice", "https://x.example/api"), DisplayAccount("b", "2", "@bob@y.example", "https://y.example/api")),
      activeSlot = "b",
      preview = false,
      sounds = false,
    )
    val back = DisplayConfig.fromJson(JSONObject(config.toJson().toString()))
    assertEquals(config, back)
    assertTrue(back.showsAccountLabel)
    assertEquals(DisplayConfig(), DisplayConfig.fromJson(JSONObject("{}")))
  }

  @Test
  fun validatesSlots() {
    assertTrue(Slots.isValid("abc_DEF-123"))
    assertFalse(Slots.isValid(""))
    assertFalse(Slots.isValid("a:b"))
    assertFalse(Slots.isValid("x".repeat(33)))
  }
}
