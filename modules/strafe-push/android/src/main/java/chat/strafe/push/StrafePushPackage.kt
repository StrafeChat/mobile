package chat.strafe.push

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/**
 * Initialises Firebase (from the build's FCM config, when it has one) as the application
 * starts - including when the process is started just to deliver a push, before any
 * JavaScript or Activity exists. Without config this does nothing and Firebase stays off.
 */
class StrafePushPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context?): List<ApplicationLifecycleListener> =
    listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          Fcm.ensureApp(application)
        }
      },
    )
}
