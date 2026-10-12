package chat.strafe.network

import android.app.Application
import android.content.Context
import android.util.Log
import com.facebook.react.modules.network.OkHttpClientProvider
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import java.util.concurrent.TimeUnit

/**
 * How the app connects, set once when the process starts - before any networking module
 * builds its client.
 *
 * React Native's shared OkHttp client is the base of everything that talks to an instance:
 * fetch (NetworkingModule), the gateway WebSocket (WebSocketModule derives its client from
 * it), images (expo-image), downloads (expo-file-system) and expo/fetch. Its defaults are
 * OkHttp 4's: addresses in the order the system resolver returns them - IPv6 first wherever
 * the network has IPv6 - and, as React Native configures it, no connect timeout at all. OkHttp
 * 4 has no Happy Eyeballs, so a host whose IPv6 address does not answer (an AAAA record with
 * nothing listening behind it on 443 is a common server misconfiguration) hangs every
 * connection on that address until the OS gives up, minutes later, while every browser
 * quietly falls back to IPv4 and "the site works". That is what made "app.strafe.chat" read
 * as unreachable on phones on IPv6 networks.
 *
 * So: try a host's IPv4 addresses first, then its IPv6 ones (IPv6-only hosts are unaffected),
 * and give each address a bounded connect timeout so a dead one falls through to the next.
 */
class StrafeNetworkPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context?): List<ApplicationLifecycleListener> =
    listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          install(application)
        }
      },
    )

  internal companion object {
    /** Per address: long enough for a slow mobile network, short enough to fall through. */
    const val CONNECT_TIMEOUT_SECONDS = 10L

    fun install(context: Context) {
      val app = context.applicationContext
      OkHttpClientProvider.setOkHttpClientFactory {
        // createClientBuilder(context) keeps React Native's cookie jar and HTTP cache.
        OkHttpClientProvider.createClientBuilder(app)
          .dns(PreferIpv4Dns)
          .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
          .build()
      }
      Log.i("StrafeNetwork", "connections try IPv4 first, ${CONNECT_TIMEOUT_SECONDS}s per address")
    }
  }
}
