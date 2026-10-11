package chat.strafe.push

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.util.Log
import android.util.LruCache
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * The few HTTP requests the push path makes without JavaScript: the instance API for the
 * background notification actions and the VAPID key, and author avatars for notifications.
 */
internal object PushHttp {
  private const val TAG = "StrafePush"
  private const val API_TIMEOUT_MS = 10_000
  private const val AVATAR_TIMEOUT_MS = 3_000
  private const val AVATAR_MAX_BYTES = 2 * 1024 * 1024
  /** The whole avatar download, however slowly the server drips it (the timeouts are per read). */
  private const val AVATAR_DEADLINE_MS = 4_000L
  private const val AVATAR_SIZE_PX = 192
  /** The largest side decoded into memory before cropping: bounds a hostile image's bitmap. */
  private const val AVATAR_DECODE_MAX_PX = 1024

  private val avatars = LruCache<String, Bitmap>(32)

  /** `POST {apiBase}{path}` as the account; true on a 2xx. */
  fun post(apiBase: String, path: String, token: String, json: JSONObject?): Boolean {
    val connection = open("$apiBase$path", API_TIMEOUT_MS) ?: return false
    return try {
      connection.requestMethod = "POST"
      connection.setRequestProperty("Authorization", "Bearer $token")
      if (json != null) {
        val body = json.toString().toByteArray()
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setFixedLengthStreamingMode(body.size)
        connection.outputStream.use { it.write(body) }
      }
      val status = connection.responseCode
      if (status !in 200..299) Log.w(TAG, "POST $path answered $status")
      status in 200..299
    } catch (e: IOException) {
      Log.w(TAG, "POST $path failed: ${e.message}")
      false
    } finally {
      connection.disconnect()
    }
  }

  /** The instance's VAPID public key (`GET /push/vapid-key`), or null. */
  fun vapidKey(apiBase: String): String? {
    val connection = open("$apiBase/push/vapid-key", API_TIMEOUT_MS) ?: return null
    return try {
      if (connection.responseCode != 200) return null
      val body = readCapped(connection.inputStream, 4096) ?: return null
      JSONObject(String(body)).optString("public_key").takeIf { it.matches(Regex("^[A-Za-z0-9_-]{87}$")) }
    } catch (e: Exception) {
      Log.w(TAG, "VAPID key fetch failed: ${e.message}")
      null
    } finally {
      connection.disconnect()
    }
  }

  /**
   * The author's avatar as a round bitmap, or null. Bounded by timeouts, a deadline for the
   * whole download and a size cap: a notification without a picture beats a late one, and
   * pushes are handled one after another. The caller decides whether the URL may be fetched
   * at all ([PushContent.avatarAllowed]).
   */
  fun avatar(url: String?): Bitmap? {
    if (url.isNullOrEmpty()) return null
    avatars.get(url)?.let { return it }
    val connection = open(url, AVATAR_TIMEOUT_MS) ?: return null
    return try {
      if (connection.responseCode != 200) return null
      val deadline = System.currentTimeMillis() + AVATAR_DEADLINE_MS
      val bytes = readCapped(connection.inputStream, AVATAR_MAX_BYTES, deadline) ?: return null
      decodeRound(bytes)?.also { avatars.put(url, it) }
    } catch (e: Exception) {
      null
    } catch (e: OutOfMemoryError) {
      // A picture is optional; the notification still goes out without it.
      null
    } finally {
      connection.disconnect()
    }
  }

  private fun open(url: String, timeoutMs: Int): HttpURLConnection? {
    return try {
      val parsed = URL(url)
      if (parsed.protocol != "https" && parsed.protocol != "http") return null
      (parsed.openConnection() as HttpURLConnection).apply {
        connectTimeout = timeoutMs
        readTimeout = timeoutMs
        instanceFollowRedirects = false
        useCaches = false
      }
    } catch (e: Exception) {
      null
    }
  }

  private fun readCapped(input: InputStream, max: Int, deadline: Long = Long.MAX_VALUE): ByteArray? {
    input.use {
      val out = ByteArrayOutputStream()
      val buffer = ByteArray(8192)
      while (true) {
        val n = it.read(buffer)
        if (n < 0) break
        if (out.size() + n > max || System.currentTimeMillis() > deadline) return null
        out.write(buffer, 0, n)
      }
      return out.toByteArray()
    }
  }

  private fun decodeRound(bytes: ByteArray): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= AVATAR_SIZE_PX && bounds.outHeight / (sample * 2) >= AVATAR_SIZE_PX) sample *= 2
    // A very long, thin image keeps one side small and would otherwise decode at full size
    // along the other (60000 x 200 pixels is 48 MB): sample until both sides are bounded.
    while (bounds.outWidth / sample > AVATAR_DECODE_MAX_PX || bounds.outHeight / sample > AVATAR_DECODE_MAX_PX) sample *= 2
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: return null
    val side = minOf(decoded.width, decoded.height)
    val square = Bitmap.createBitmap(decoded, (decoded.width - side) / 2, (decoded.height - side) / 2, side, side)
    val scaled = Bitmap.createScaledBitmap(square, AVATAR_SIZE_PX, AVATAR_SIZE_PX, true)
    val round = Bitmap.createBitmap(AVATAR_SIZE_PX, AVATAR_SIZE_PX, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(round)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val radius = AVATAR_SIZE_PX / 2f
    canvas.drawCircle(radius, radius, radius, paint)
    paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
    canvas.drawBitmap(scaled, 0f, 0f, paint)
    return round
  }
}
