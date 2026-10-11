# The StrafePush Expo module (autolinked from modules/strafe-push). Shared/ is also compiled into
# the Notification Service Extension target that plugins/withStrafePushIos.js adds, so the keys,
# the RFC 8291 decryption and the rendering rules exist once. Package.swift and Tests/ are the
# macOS `swift test` harness for Shared/ and are not part of the pod.
Pod::Spec.new do |s|
  s.name           = 'StrafePush'
  s.version        = '1.0.0'
  s.summary        = 'Strafe push notifications: Web Push keys, decryption and rendering'
  s.description    = 'Native half of Strafe push notifications for iOS (APNs + Notification Service Extension).'
  s.license        = 'GPL-3.0-only'
  s.author         = 'StrafeChat'
  s.homepage       = 'https://github.com/StrafeChat/mobile'
  s.platforms      = {
    :ios => '16.4',
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/StrafeChat/mobile.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'Module/**/*.swift', 'Shared/**/*.swift'
  s.frameworks = 'CryptoKit', 'Security', 'UserNotifications'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
