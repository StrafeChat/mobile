import Foundation

/**
 The plaintext inside a push (docs/PUSH.md, "Payload"): compact JSON with short field names,
 ids as strings. Unknown fields are ignored; an unknown version or event type is not an error,
 just something this build doesn't act on.
 */
struct PushPayload: Decodable, Equatable {
  enum Kind: String, Decodable {
    case message = "msg"
    case read
    case call
    case callEnd = "call_end"
    case test
  }

  struct Author: Decodable, Equatable {
    let id: String
    /// Display name, else username; never empty.
    let name: String
    let avatar: String?

    private enum CodingKeys: String, CodingKey {
      case id
      case name = "n"
      case avatar = "av"
    }
  }

  enum ParseResult: Equatable {
    case payload(PushPayload)
    /// A version or event type this build doesn't know: do nothing.
    case unsupported
    /// Not the JSON the contract describes: treat like a decryption failure.
    case malformed
  }

  static let version = 1

  let kind: Kind
  /// The account the push is for.
  let userId: String
  let timestamp: Int64?
  let roomId: String?
  /// 1 PM, 2 group PM, 3 space text, 4 space voice, 6 thread.
  let roomType: Int?
  let spaceId: String?
  let messageId: String?
  let author: Author?
  /// Room name: channel / thread / group PM name. Absent for 1:1 PMs.
  let roomName: String?
  /// Thread only: the parent room's name.
  let parentName: String?
  let spaceName: String?
  let encrypted: Bool
  /// Body preview; only for rooms that aren't end-to-end encrypted, and only with previews on.
  let body: String?
  let attachments: Int
  let mentioned: Bool

  private enum CodingKeys: String, CodingKey {
    case kind = "t"
    case userId = "uid"
    case timestamp = "ts"
    case roomId = "rid"
    case roomType = "rt"
    case spaceId = "sid"
    case messageId = "mid"
    case author = "a"
    case roomName = "rn"
    case parentName = "pn"
    case spaceName = "sn"
    case encrypted = "e"
    case body = "b"
    case attachments = "att"
    case mentioned = "m"
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    kind = try c.decode(Kind.self, forKey: .kind)
    userId = try c.decode(String.self, forKey: .userId)
    timestamp = try c.decodeIfPresent(Int64.self, forKey: .timestamp)
    roomId = try c.decodeIfPresent(String.self, forKey: .roomId)
    roomType = try c.decodeIfPresent(Int.self, forKey: .roomType)
    spaceId = try c.decodeIfPresent(String.self, forKey: .spaceId)
    messageId = try c.decodeIfPresent(String.self, forKey: .messageId)
    author = try c.decodeIfPresent(Author.self, forKey: .author)
    roomName = try c.decodeIfPresent(String.self, forKey: .roomName)
    parentName = try c.decodeIfPresent(String.self, forKey: .parentName)
    spaceName = try c.decodeIfPresent(String.self, forKey: .spaceName)
    encrypted = try c.decodeIfPresent(Bool.self, forKey: .encrypted) ?? false
    body = try c.decodeIfPresent(String.self, forKey: .body)
    attachments = try c.decodeIfPresent(Int.self, forKey: .attachments) ?? 0
    mentioned = try c.decodeIfPresent(Bool.self, forKey: .mentioned) ?? false
  }

  /// Just enough to decide whether this build understands the rest.
  private struct Envelope: Decodable {
    let v: Int?
    let t: String?
  }

  static func parse(_ data: Data) -> ParseResult {
    guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else {
      return .malformed
    }
    guard envelope.v == version, let t = envelope.t, Kind(rawValue: t) != nil else {
      return .unsupported
    }
    guard let payload = try? JSONDecoder().decode(PushPayload.self, from: data), payload.isComplete else {
      return .malformed
    }
    return .payload(payload)
  }

  /// The fields each event type can't be acted on without.
  private var isComplete: Bool {
    switch kind {
    case .message: return roomId != nil && author != nil
    case .call: return roomId != nil && author != nil
    case .read, .callEnd: return roomId != nil
    case .test: return true
    }
  }
}
