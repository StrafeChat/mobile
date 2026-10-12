package chat.strafe.network

import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Test

class PreferIpv4DnsTest {
  private fun ip(s: String): InetAddress = InetAddress.getByName(s)

  @Test
  fun ipv4AddressesComeFirstInTheirOwnOrder() {
    val resolved = listOf(ip("2605:a140:2361:5136::1"), ip("157.173.199.188"), ip("2001:db8::2"), ip("192.0.2.7"))
    assertEquals(
      listOf(ip("157.173.199.188"), ip("192.0.2.7"), ip("2605:a140:2361:5136::1"), ip("2001:db8::2")),
      PreferIpv4Dns.ipv4First(resolved),
    )
  }

  @Test
  fun aSingleFamilyIsLeftAlone() {
    val v6 = listOf(ip("2001:db8::1"), ip("2001:db8::2"))
    assertEquals(v6, PreferIpv4Dns.ipv4First(v6))
    val v4 = listOf(ip("192.0.2.1"))
    assertEquals(v4, PreferIpv4Dns.ipv4First(v4))
  }
}
