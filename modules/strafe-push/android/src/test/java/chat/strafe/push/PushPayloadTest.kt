package chat.strafe.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PushPayloadTest {
  @Test
  fun parsesASpaceMessage() {
    val p = PushPayload.parse(
      """{"v":1,"t":"msg","uid":"123","ts":1760000000000,"rid":"456","rt":3,"sid":"789","mid":"1011",""" +
        """"a":{"id":"1213","n":"Alice","av":"https://cdn.example/a.webp"},"rn":"general","sn":"Strafe HQ","b":"hey","att":2,"m":true,"zz":1}""",
    )!!
    assertEquals("msg", p.type)
    assertEquals("123", p.userId)
    assertEquals(1760000000000L, p.timestamp)
    assertEquals("456", p.roomId)
    assertEquals(3, p.roomType)
    assertEquals("789", p.spaceId)
    assertEquals("1011", p.messageId)
    assertEquals(PushAuthor("1213", "Alice", "https://cdn.example/a.webp"), p.author)
    assertEquals("general", p.roomName)
    assertEquals("Strafe HQ", p.spaceName)
    assertEquals("hey", p.body)
    assertEquals(2, p.attachments)
    assertTrue(p.mentioned)
  }

  @Test
  fun dropsTheBodyOfAnEncryptedRoom() {
    val p = PushPayload.parse("""{"v":1,"t":"msg","uid":"1","ts":1,"rid":"2","rt":1,"mid":"3","a":{"id":"4","n":"A"},"e":true,"b":"leak"}""")!!
    assertTrue(p.encrypted)
    assertNull(p.body)
  }

  @Test
  fun ignoresWhatItDoesNotUnderstand() {
    assertNull(PushPayload.parse("""{"v":2,"t":"msg","uid":"1"}"""))
    assertNull(PushPayload.parse("""{"v":1,"t":"poke","uid":"1","rid":"2","rt":1}"""))
    assertNull(PushPayload.parse("""{"v":1,"t":"test"}"""))
    assertNull(PushPayload.parse("not json"))
    // A message without its author or id.
    assertNull(PushPayload.parse("""{"v":1,"t":"msg","uid":"1","rid":"2","rt":1,"mid":"3"}"""))
    assertNull(PushPayload.parse("""{"v":1,"t":"msg","uid":"1","rid":"2","rt":1,"a":{"id":"4","n":"A"}}"""))
    // Ids must be snowflake strings (they end up in tags and deep links).
    assertNull(PushPayload.parse("""{"v":1,"t":"read","uid":"1","rid":"2&x=y","rt":1,"mid":"3"}"""))
    assertNull(PushPayload.parse("""{"v":1,"t":"read","uid":"1","rid":2,"rt":1,"mid":"3"}"""))
    assertNull(PushPayload.parse("""{"v":1,"t":"call_end","uid":"1","rid":"2","rt":9}"""))
  }

  @Test
  fun parsesTheOtherTypes() {
    assertEquals("test", PushPayload.parse("""{"v":1,"t":"test","uid":"1","ts":5}""")?.type)
    val read = PushPayload.parse("""{"v":1,"t":"read","uid":"1","ts":5,"rid":"2","rt":2,"mid":"9"}""")!!
    assertEquals("9", read.messageId)
    val call = PushPayload.parse("""{"v":1,"t":"call","uid":"1","ts":5,"rid":"2","rt":2,"a":{"id":"4","n":"Bob"},"rn":"Weekend plans","vid":false}""")!!
    assertEquals("Bob", call.author?.name)
    assertEquals("Weekend plans", call.roomName)
    assertNotNull(PushPayload.parse("""{"v":1,"t":"call_end","uid":"1","ts":5,"rid":"2","rt":1}"""))
    assertFalse(call.mentioned)
  }
}
