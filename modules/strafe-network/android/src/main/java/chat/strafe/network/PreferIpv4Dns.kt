package chat.strafe.network

import java.net.Inet4Address
import java.net.InetAddress
import okhttp3.Dns

/**
 * The system resolver's answer with IPv4 addresses first, each family keeping its own order.
 * OkHttp tries a host's addresses one after another, so this makes a working IPv4 address win
 * over an IPv6 one that never answers; a host with only one family resolves as before.
 */
internal object PreferIpv4Dns : Dns {
  override fun lookup(hostname: String): List<InetAddress> = ipv4First(Dns.SYSTEM.lookup(hostname))

  fun ipv4First(addresses: List<InetAddress>): List<InetAddress> {
    val (v4, v6) = addresses.partition { it is Inet4Address }
    return v4 + v6
  }
}
