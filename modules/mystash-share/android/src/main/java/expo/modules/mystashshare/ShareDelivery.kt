package expo.modules.mystashshare

import android.content.Context
import androidx.work.*
import org.json.JSONObject
import java.net.URI
import java.net.HttpURLConnection
import java.util.concurrent.TimeUnit

class ShareDelivery(c: Context, params: WorkerParameters) : Worker(c, params) {
  override fun doWork(): Result {
    val c = applicationContext
    val session = ShareStore.session(c) ?: return Result.success()
    if (session.optLong("expiresAt") * 1000 <= System.currentTimeMillis() + 30000) return Result.success()
    val owner = session.getString("accountId")
    var deferred = false
    for (record in ShareStore.all(c).filter { !it.isNull("owner") && it.optString("owner") == owner && it.optString("state") == "pending" }.take(25)) {
      if (isStopped || ShareStore.session(c)?.toString() != session.toString()) return Result.success()
      if (record.optLong("notBefore") > System.currentTimeMillis()) { deferred = true; continue }
      if (runAttemptCount >= 12) { ShareStore.save(c, record.put("state", "needs_review")); continue }
      try {
        val base = URI(session.getString("apiBase"))
        check(base.scheme == "https" && base.userInfo == null && base.query == null && base.fragment == null)
        val connection = URI(base.toString().trimEnd('/') + "/imports/accept").toURL().openConnection() as HttpURLConnection
        try {
          connection.instanceFollowRedirects = false
          connection.requestMethod = "POST"; connection.connectTimeout = 8000; connection.readTimeout = 8000
          connection.doOutput = true
          connection.setRequestProperty("Content-Type", "application/json")
          connection.setRequestProperty("Authorization", "Bearer " + session.getString("accessToken"))
          val body = JSONObject().put("text", record.getString("url")).put("clientCaptureId", record.getString("id"))
          record.optJSONObject("intent")?.let { body.put("intent", it) }
          connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
          val code = connection.responseCode
          if (code in 200..299) {
            val reply = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            check(reply.optInt("protocolVersion") == 2 && reply.optString("delivery") == "accepted" && reply.optString("importId").isNotEmpty())
            // Retain conflicting private intent for explicit in-app review.
            if (reply.optJSONObject("intent")?.optString("state") == "conflict") {
              ShareStore.save(c, record.put("state", "intent_conflict").put("importId", reply.getString("importId")))
            } else ShareStore.discard(c, record.getString("id"), owner)
          } else if (code == 401 || code == 403) {
            ShareStore.save(c, record.put("state", "needs_auth"))
            return Result.success() // Session bridge will resume; never refresh credentials here.
          } else if (code == 429 || code >= 500 || code == 404) {
            val header = connection.getHeaderField("Retry-After")
            val seconds = header?.toLongOrNull() ?: try {
              ((java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", java.util.Locale.US).parse(header ?: "")?.time ?: 0) - System.currentTimeMillis()) / 1000
            } catch (_: Exception) { 60 }
            ShareStore.save(c, record.put("notBefore", System.currentTimeMillis() + seconds.coerceIn(15, 86400) * 1000 + (Math.random() * 10000).toLong()))
            deferred = true
          } else ShareStore.save(c, record.put("state", "needs_review"))
        } finally { connection.disconnect() }
      } catch (_: Exception) { deferred = true }
    }
    if (!deferred && ShareStore.all(c).any { it.optString("owner") == owner && it.optString("state") == "pending" }) schedule(c)
    return if (deferred) Result.retry() else Result.success()
  }
  companion object {
    fun schedule(c: Context) {
      val work = OneTimeWorkRequest.Builder(ShareDelivery::class.java)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
      WorkManager.getInstance(c).enqueueUniqueWork("mystash-share-delivery", ExistingWorkPolicy.APPEND_OR_REPLACE, work)
    }
  }
}
