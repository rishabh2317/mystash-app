package expo.modules.mystashshare

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.util.UUID
import android.net.Uri
import android.util.Base64
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** One process, one lock; keys and records are excluded from Android backups. */
object ShareStore {
  private fun directory(c: Context) = File(c.noBackupFilesDir, "mystash-share").apply { mkdirs() }
  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey("mystash.share.v1", null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder("mystash.share.v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  private fun read(c: Context, name: String): JSONObject? {
    val file = File(directory(c), name)
    if (!file.exists()) return null
    val bytes = file.readBytes()
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    return JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
  }
  private fun write(c: Context, name: String, value: JSONObject) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val tmp = File(directory(c), "$name.tmp")
    FileOutputStream(tmp).use { it.write(cipher.iv + cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))); it.fd.sync() }
    check(tmp.renameTo(File(directory(c), name))) { "Storage unavailable" }
  }
  @Synchronized fun session(c: Context): JSONObject? = read(c, "session")
  @Synchronized fun sync(c: Context, session: JSONObject?) {
    if (session == null) {
      val file = File(directory(c), "session")
      check(!file.exists() || file.delete()) { "Could not clear share authentication" }
    } else write(c, "session", session)
    if (session != null) all(c).filter { it.optString("owner") == session.optString("accountId") && it.optString("state") == "needs_auth" }
      .forEach { save(c, it.put("state", "pending")) }
  }
  @Synchronized fun all(c: Context): List<JSONObject> = directory(c).listFiles()?.filter { it.name.endsWith(".share") }
    ?.mapNotNull { read(c, it.name) } ?: emptyList()
  @Synchronized fun save(c: Context, record: JSONObject) = write(c, record.getString("id") + ".share", record)
  @Synchronized fun capture(c: Context, url: String, intent: JSONObject?): JSONObject {
    check(all(c).size < 500) { "Pending storage full. Open Mystash to review your shares." }
    val record = JSONObject().put("id", UUID.randomUUID().toString()).put("url", url)
      .put("owner", session(c)?.optString("accountId") ?: JSONObject.NULL)
      .put("state", "pending").put("createdAt", System.currentTimeMillis())
    if (intent != null) record.put("intent", intent)
    save(c, record)
    return record
  }
  @Synchronized fun visible(c: Context, expectedOwner: String?): List<JSONObject> {
    val owner = session(c)?.optString("accountId")
    check(owner == expectedOwner) { "Account changed" }
    return all(c).filter { it.isNull("owner") || (owner != null && it.optString("owner") == owner) }
  }
  @Synchronized fun claim(c: Context, id: String, expectedOwner: String) {
    val account = session(c)?.getString("accountId") ?: error("Sign in first")
    check(account == expectedOwner) { "Account changed" }
    val record = visible(c, expectedOwner).find { it.optString("id") == id } ?: error("Share not found")
    check(record.isNull("owner")) { "Already assigned" }
    save(c, record.put("owner", account).put("state", "pending"))
  }
  @Synchronized fun discard(c: Context, id: String, expectedOwner: String?) {
    check(visible(c, expectedOwner).any { it.optString("id") == id }) { "Share not found" }
    check(File(directory(c), "$id.share").delete()) { "Could not remove share" }
  }
  @Synchronized fun retry(c: Context, expectedOwner: String) {
    val owner = session(c)?.optString("accountId") ?: return
    check(owner == expectedOwner) { "Account changed" }
    all(c).filter { it.optString("owner") == owner && it.optString("state") in listOf("needs_review", "needs_auth") }
      .forEach { save(c, it.put("state", "pending").put("notBefore", 0)) }
  }
  // Versioned image envelopes are separate from .share; old URL records are untouched.
  private fun image(c: Context, id: String, owner: String): JSONObject {
    check(UUID.fromString(id).toString() == id && session(c)?.optString("accountId") == owner) { "Account changed" }
    return read(c, "$id.image")?.also { check(it.optString("owner") == owner) { "Account changed" } } ?: error("Capture unavailable")
  }
  private fun imageRows(c: Context) = directory(c).listFiles()?.filter { it.name.endsWith(".image") }?.mapNotNull { file -> read(c,file.name)?.let { imageSummary(it) } } ?: emptyList()
  private fun imageSummary(record: JSONObject) = JSONObject(record.toString()).apply { remove("bytes") }
  @Synchronized fun enqueueUrl(c: Context, raw: String, owner: String): JSONObject {
    check(session(c)?.optString("accountId") == owner) { "Account changed" }
    val url = ShareActivity.validatedUrl(raw) ?: error("Invalid link")
    all(c).find { it.optString("owner") == owner && it.optString("url") == url && it.optString("state") != "intent_conflict" }?.let { return it }
    return capture(c,url,null)
  }
  @Synchronized fun enqueueImage(c: Context, uri: String, origin: String, owner: String): JSONObject {
    check(session(c)?.optString("accountId") == owner && origin in listOf("camera","gallery")) { "Account changed" }
    val parsed = Uri.parse(uri); check(parsed.scheme == "file") { "Invalid image" }
    val file = File(parsed.path ?: error("Invalid image")).canonicalFile
    check(file.path.startsWith(c.cacheDir.canonicalPath + File.separator) && file.length() in 1..5242880) { "Invalid image" }
    val bytes = file.readBytes(); check(bytes.size <= 5242880 && bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte()) { "Invalid image" }
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    val rows = imageRows(c)
    rows.find { it.optString("owner") == owner && it.optString("sha256") == digest && it.optString("state") != "accepted" }?.let { return imageSummary(it) }
    check(rows.size < 20) { "Pending image storage full" }
    val id = UUID.randomUUID().toString()
    val record = JSONObject().put("version",1).put("id",id).put("owner",owner).put("origin",origin).put("mime","image/jpeg")
      .put("sha256",digest).put("size",bytes.size).put("bytes",Base64.encodeToString(bytes,Base64.NO_WRAP)).put("state","pending").put("createdAt",System.currentTimeMillis()).put("attempts",0).put("notBefore",0)
    write(c,"$id.image",record); return imageSummary(record)
  }
  @Synchronized fun listImages(c: Context, owner: String): List<JSONObject> {
    check(session(c)?.optString("accountId") == owner) { "Account changed" }
    return imageRows(c).filter { it.optString("owner") == owner }.map { imageSummary(it) }
  }
  @Synchronized fun imageBytes(c: Context, id: String, owner: String) = image(c,id,owner).getString("bytes")
  @Synchronized fun updateImage(c: Context, id: String, owner: String, patch: JSONObject) {
    val record = image(c,id,owner)
    check(patch.keys().asSequence().all { it in listOf("state","attempts","notBefore","uploadId","importId") }) { "Invalid capture update" }
    if (patch.has("state")) check(patch.getString("state") in listOf("pending","uploading","needs_auth","needs_review","accepted"))
    for (key in listOf("uploadId","importId")) if (patch.has(key)) UUID.fromString(patch.getString(key))
    patch.keys().forEach { record.put(it,patch.get(it)) }
    if (record.optString("state") == "accepted") { check(record.optString("importId").isNotEmpty()); record.remove("bytes") }
    write(c,"$id.image",record)
  }
  @Synchronized fun removeImage(c: Context, id: String, owner: String) { image(c,id,owner); check(File(directory(c),"$id.image").delete()) }
}
