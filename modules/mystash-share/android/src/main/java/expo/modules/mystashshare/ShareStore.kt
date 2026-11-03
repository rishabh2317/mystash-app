package expo.modules.mystashshare

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.util.UUID
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
}
