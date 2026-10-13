package chat.strafe.push

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.InvalidKeyException
import java.security.KeyStoreException
import java.security.UnrecoverableKeyException
import java.security.spec.InvalidKeySpecException
import javax.crypto.AEADBadTagException
import javax.crypto.IllegalBlockSizeException

/**
 * Which failures discard a sealed value (slot keys, a session token): only those no later
 * attempt could undo. A transient keystore fault must keep the keys an instance encrypts to.
 */
class PushStoreTest {
  @Test
  fun discardsWhatCanNeverOpen() {
    // The wrapping key was replaced (or the bytes changed): the GCM tag fails.
    assertTrue(neverOpens(AEADBadTagException("tag mismatch")))
    // Malformed on disk.
    assertTrue(neverOpens(MalformedSealedValueException("truncated")))
    assertTrue(neverOpens(WebPushException("not base64url")))
    assertTrue(neverOpens(InvalidKeySpecException("not PKCS#8")))
  }

  @Test
  fun keepsWhatTheKeystoreFailedToOpenThisTime() {
    // How AndroidKeyStore reports a fault in doFinal / init / the store itself.
    assertFalse(neverOpens(IllegalBlockSizeException("keystore operation failed")))
    assertFalse(neverOpens(InvalidKeyException("keystore operation failed")))
    assertFalse(neverOpens(KeyStoreException("system error")))
    // About fetching the wrapping key, not the value: discarding would not help.
    assertFalse(neverOpens(UnrecoverableKeyException("failed to obtain information about key")))
  }
}
