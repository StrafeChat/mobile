import XCTest
@testable import StrafePushShared

final class PushPayloadTests: XCTestCase {
  func testParsesAMessage() {
    let payload = Fixtures.payload(#"""
    {"v":1,"t":"msg","uid":"100","ts":1760000000000,"rid":"456","rt":3,"sid":"789","mid":"1011",
     "a":{"id":"1213","n":"Alice","av":"https://cdn.example/a.webp"},"rn":"general","sn":"Strafe HQ",
     "b":"hey @Bob","att":2,"m":true,"future":"ignored"}
    """#)
    XCTAssertEqual(payload.kind, .message)
    XCTAssertEqual(payload.userId, "100")
    XCTAssertEqual(payload.timestamp, 1_760_000_000_000)
    XCTAssertEqual(payload.roomId, "456")
    XCTAssertEqual(payload.roomType, 3)
    XCTAssertEqual(payload.spaceId, "789")
    XCTAssertEqual(payload.messageId, "1011")
    XCTAssertEqual(payload.author, PushPayload.Author(id: "1213", name: "Alice", avatar: "https://cdn.example/a.webp"))
    XCTAssertEqual(payload.roomName, "general")
    XCTAssertEqual(payload.spaceName, "Strafe HQ")
    XCTAssertEqual(payload.body, "hey @Bob")
    XCTAssertEqual(payload.attachments, 2)
    XCTAssertTrue(payload.mentioned)
    XCTAssertFalse(payload.encrypted)
  }

  func testOptionalFlagsDefault() {
    let payload = Fixtures.payload(#"{"v":1,"t":"msg","uid":"1","rid":"2","rt":1,"mid":"3","a":{"id":"4","n":"Al"}}"#)
    XCTAssertFalse(payload.encrypted)
    XCTAssertFalse(payload.mentioned)
    XCTAssertEqual(payload.attachments, 0)
    XCTAssertNil(payload.body)
  }

  func testUnknownVersionOrTypeIsIgnored() {
    XCTAssertEqual(PushPayload.parse(Data(#"{"v":2,"t":"msg","uid":"1"}"#.utf8)), .unsupported)
    XCTAssertEqual(PushPayload.parse(Data(#"{"t":"msg","uid":"1"}"#.utf8)), .unsupported)
    XCTAssertEqual(PushPayload.parse(Data(#"{"v":1,"t":"typing","uid":"1"}"#.utf8)), .unsupported)
  }

  func testMalformedPayloads() {
    XCTAssertEqual(PushPayload.parse(Data("not json".utf8)), .malformed)
    // No room id: nothing to show or clear.
    XCTAssertEqual(PushPayload.parse(Data(#"{"v":1,"t":"msg","uid":"1","a":{"id":"4","n":"Al"}}"#.utf8)), .malformed)
    XCTAssertEqual(PushPayload.parse(Data(#"{"v":1,"t":"read","uid":"1"}"#.utf8)), .malformed)
    // No recipient.
    XCTAssertEqual(PushPayload.parse(Data(#"{"v":1,"t":"test"}"#.utf8)), .malformed)
    // Ids are strings on the wire.
    XCTAssertEqual(PushPayload.parse(Data(#"{"v":1,"t":"read","uid":"1","rid":2}"#.utf8)), .malformed)
  }
}

final class PushRendererTests: XCTestCase {
  private func show(_ json: String, slot: String = "acct1", config: PushDisplayConfig = Fixtures.config()) -> PushNotification? {
    guard case .show(let notification) = PushRenderer.action(for: Fixtures.payload(json), slot: slot, config: config) else {
      return nil
    }
    return notification
  }

  func testPrivateMessage() throws {
    let n = try XCTUnwrap(show(#"{"v":1,"t":"msg","uid":"100","rid":"5","rt":1,"mid":"9","a":{"id":"7","n":"Alice"},"b":"hi there"}"#))
    XCTAssertEqual(n.title, "Alice")
    XCTAssertEqual(n.subtitle, "")
    XCTAssertEqual(n.body, "hi there")
    XCTAssertEqual(n.threadIdentifier, "strafe:acct1:room:5")
    XCTAssertEqual(n.categoryIdentifier, "strafe.message")
    XCTAssertEqual(n.sound, .standard)
    XCTAssertEqual(n.interruption, .active)
    XCTAssertTrue(n.countsTowardsBadge)
    XCTAssertEqual(n.routing, ["slot": "acct1", "t": "msg", "rid": "5", "mid": "9"])
  }

  func testGroupPrivateMessage() throws {
    let n = try XCTUnwrap(show(#"{"v":1,"t":"msg","uid":"100","rid":"5","rt":2,"mid":"9","a":{"id":"7","n":"Alice"},"rn":"Weekend plans","e":true}"#))
    XCTAssertEqual(n.title, "Weekend plans")
    XCTAssertEqual(n.subtitle, "Alice")
    XCTAssertEqual(n.body, "Encrypted message")
  }

  func testSpaceRoomAndThreadTitles() throws {
    let room = try XCTUnwrap(show(#"{"v":1,"t":"msg","uid":"100","rid":"5","rt":3,"sid":"8","mid":"9","a":{"id":"7","n":"Alice"},"rn":"general","sn":"Strafe HQ"}"#))
    XCTAssertEqual(room.title, "#general · Strafe HQ")
    XCTAssertEqual(room.subtitle, "Alice")
    XCTAssertEqual(room.body, "New message")
    XCTAssertEqual(room.routing, ["slot": "acct1", "t": "msg", "rid": "5", "sid": "8", "mid": "9"])

    let thread = try XCTUnwrap(show(#"{"v":1,"t":"msg","uid":"100","rid":"6","rt":6,"sid":"8","mid":"9","a":{"id":"7","n":"Alice"},"rn":"Release notes","pn":"announcements","sn":"Strafe HQ"}"#))
    XCTAssertEqual(thread.title, "Release notes · #announcements")

    let unnamed = try XCTUnwrap(show(#"{"v":1,"t":"msg","uid":"100","rid":"5","rt":3,"mid":"9","a":{"id":"7","n":"Alice"},"rn":"general"}"#))
    XCTAssertEqual(unnamed.title, "#general")
  }

  func testBodyPrecedence() throws {
    let base = #""v":1,"t":"msg","uid":"100","rid":"5","rt":1,"mid":"9","a":{"id":"7","n":"Alice"}"#
    XCTAssertEqual(show("{\(base),\"b\":\"text\",\"att\":1}")?.body, "text")
    XCTAssertEqual(show("{\(base),\"att\":1}")?.body, "Sent an attachment")
    XCTAssertEqual(show("{\(base),\"e\":true,\"att\":1}")?.body, "Encrypted message")
    // A body in an end-to-end encrypted room is never shown, even if a push carries one.
    XCTAssertEqual(show("{\(base),\"e\":true,\"b\":\"text\"}")?.body, "Encrypted message")
    XCTAssertEqual(show("{\(base)}")?.body, "New message")
    // Previews off on this device: the text the server sent is not shown.
    XCTAssertEqual(show("{\(base),\"b\":\"text\"}", config: Fixtures.config(preview: false))?.body, "New message")
  }

  func testSoundsPreference() throws {
    let json = #"{"v":1,"t":"msg","uid":"100","rid":"5","rt":1,"mid":"9","a":{"id":"7","n":"Alice"}}"#
    XCTAssertEqual(show(json, config: Fixtures.config(sounds: false))?.sound, PushNotification.Sound.none)
  }

  func testAccountLabelWithSeveralAccounts() throws {
    let config = Fixtures.config(accounts: [Fixtures.alice, Fixtures.bob])
    let pm = try XCTUnwrap(show(#"{"v":1,"t":"msg","uid":"200","rid":"5","rt":1,"mid":"9","a":{"id":"7","n":"Alice"}}"#, slot: "acct2", config: config))
    XCTAssertEqual(pm.subtitle, "@bob@b.example")
    XCTAssertEqual(pm.threadIdentifier, "strafe:acct2:room:5")
    let room = try XCTUnwrap(show(#"{"v":1,"t":"msg","uid":"200","rid":"5","rt":3,"mid":"9","a":{"id":"7","n":"Alice"},"rn":"general","sn":"HQ"}"#, slot: "acct2", config: config))
    XCTAssertEqual(room.subtitle, "Alice · @bob@b.example")
  }

  func testPushForAnotherUserOrAnUnknownSlotShowsNothing() {
    let json = #"{"v":1,"t":"msg","uid":"999","rid":"5","rt":1,"mid":"9","a":{"id":"7","n":"Alice"}}"#
    XCTAssertEqual(PushRenderer.action(for: Fixtures.payload(json), slot: "acct1", config: Fixtures.config()), .nothing)
    let mine = #"{"v":1,"t":"msg","uid":"100","rid":"5","rt":1,"mid":"9","a":{"id":"7","n":"Alice"}}"#
    XCTAssertEqual(PushRenderer.action(for: Fixtures.payload(mine), slot: "gone", config: Fixtures.config()), .nothing)
  }

  func testReadAndCallEndRemove() {
    let read = Fixtures.payload(#"{"v":1,"t":"read","uid":"100","rid":"5","rt":3,"mid":"9"}"#)
    XCTAssertEqual(PushRenderer.action(for: read, slot: "acct1", config: Fixtures.config()), .remove(threadIdentifier: "strafe:acct1:room:5"))
    // Removing needs no strings, so it works before the app has stored a config.
    XCTAssertEqual(PushRenderer.action(for: read, slot: "acct1", config: nil), .remove(threadIdentifier: "strafe:acct1:room:5"))
    let end = Fixtures.payload(#"{"v":1,"t":"call_end","uid":"100","rid":"5","rt":1}"#)
    XCTAssertEqual(PushRenderer.action(for: end, slot: "acct1", config: Fixtures.config()), .remove(threadIdentifier: "strafe:acct1:call:5"))
  }

  func testMessagesNeedAConfig() {
    let json = #"{"v":1,"t":"msg","uid":"100","rid":"5","rt":1,"mid":"9","a":{"id":"7","n":"Alice"}}"#
    XCTAssertNil(PushRenderer.action(for: Fixtures.payload(json), slot: "acct1", config: nil))
  }

  func testCalls() throws {
    let pm = try XCTUnwrap(show(#"{"v":1,"t":"call","uid":"100","rid":"5","rt":1,"a":{"id":"7","n":"Alice"}}"#))
    XCTAssertEqual(pm.title, "Incoming call")
    XCTAssertEqual(pm.body, "Alice is calling")
    XCTAssertEqual(pm.threadIdentifier, "strafe:acct1:call:5")
    XCTAssertEqual(pm.categoryIdentifier, "strafe.call")
    XCTAssertEqual(pm.interruption, .timeSensitive)
    XCTAssertFalse(pm.countsTowardsBadge)
    XCTAssertEqual(pm.routing, ["slot": "acct1", "t": "call", "rid": "5"])

    let group = try XCTUnwrap(show(#"{"v":1,"t":"call","uid":"100","rid":"5","rt":2,"a":{"id":"7","n":"Alice"},"rn":"Weekend plans"}"#))
    XCTAssertEqual(group.body, "Alice is calling Weekend plans")
    // Calls ring even with message sounds off.
    let quiet = try XCTUnwrap(show(#"{"v":1,"t":"call","uid":"100","rid":"5","rt":1,"a":{"id":"7","n":"Alice"}}"#, config: Fixtures.config(sounds: false)))
    XCTAssertEqual(quiet.sound, .standard)
  }

  func testTestPush() throws {
    let n = try XCTUnwrap(show(#"{"v":1,"t":"test","uid":"100"}"#))
    XCTAssertEqual(n.title, "Test notification")
    XCTAssertEqual(n.body, "Push notifications work.")
    XCTAssertEqual(n.threadIdentifier, "strafe:acct1:test")
    XCTAssertEqual(n.routing, ["slot": "acct1", "t": "test"])
  }

  func testFillIsSinglePass() {
    XCTAssertEqual(PushRenderer.fill("{{name}} is calling {{room}}", ["name": "{{room}}", "room": "Den"]), "{{room}} is calling Den")
    XCTAssertEqual(PushRenderer.fill("{{unknown}} {{name", ["name": "x"]), "{{unknown}} {{name")
    XCTAssertEqual(PushRenderer.fill("no placeholders", ["name": "x"]), "no placeholders")
  }
}

final class PushIdentifiersTests: XCTestCase {
  func testSlots() {
    XCTAssertTrue(PushSlot.isValid("a"))
    XCTAssertTrue(PushSlot.isValid("Acct_1-x"))
    XCTAssertTrue(PushSlot.isValid(String(repeating: "a", count: 32)))
    XCTAssertFalse(PushSlot.isValid(""))
    XCTAssertFalse(PushSlot.isValid(String(repeating: "a", count: 33)))
    XCTAssertFalse(PushSlot.isValid("a:b"))
    XCTAssertFalse(PushSlot.isValid("é"))
  }

  func testThreads() {
    XCTAssertTrue(PushThread.belongs("strafe:acct1:room:5", toSlot: "acct1"))
    XCTAssertFalse(PushThread.belongs("strafe:acct10:room:5", toSlot: "acct1"))
    XCTAssertTrue(PushThread.belongs("strafe:acct10:call:5", toSlot: nil))
    XCTAssertFalse(PushThread.belongs("other", toSlot: nil))
    XCTAssertTrue(PushThread.isRoom("strafe:acct1:room:5"))
    XCTAssertFalse(PushThread.isRoom("strafe:acct1:call:5"))
    XCTAssertFalse(PushThread.isRoom(PushThread.undecrypted(slot: "acct1")))
  }
}
