import Foundation

/**
 Which APNs environment a build's device tokens belong to. A token is only valid against the
 environment its provisioning profile names (`aps-environment`), and the gateway has to send it
 to the matching APNs host, so the app tells it when it registers.
 */
enum ProvisioningProfile {
  enum ApnsEnvironment: String {
    case sandbox
    case production
  }

  /// The running build's environment.
  static func currentApnsEnvironment(bundle: Bundle = .main) -> ApnsEnvironment {
    #if targetEnvironment(simulator)
    // Simulators receive pushes through the sandbox (Xcode 14+ on Apple silicon / T2 Macs).
    return .sandbox
    #else
    // App Store and TestFlight builds carry no embedded profile, and are production.
    guard let url = bundle.url(forResource: "embedded", withExtension: "mobileprovision"),
          let data = try? Data(contentsOf: url) else {
      return .production
    }
    return apnsEnvironment(fromProfile: data) ?? .production
    #endif
  }

  /**
   A .mobileprovision file is a CMS (PKCS #7) signed message whose content is an XML property
   list, stored as-is inside the DER; reading it needs no CMS parsing, only finding the plist.
   */
  static func apnsEnvironment(fromProfile data: Data) -> ApnsEnvironment? {
    guard let start = data.range(of: Data("<?xml".utf8)),
          let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
          let plist = try? PropertyListSerialization.propertyList(
            from: data.subdata(in: start.lowerBound..<end.upperBound),
            options: [],
            format: nil
          ) as? [String: Any],
          let entitlements = plist["Entitlements"] as? [String: Any],
          let environment = entitlements["aps-environment"] as? String else {
      return nil
    }
    return environment == "development" ? .sandbox : .production
  }
}
