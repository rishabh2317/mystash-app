package expo.modules.mystashshare
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.json.JSONArray
import org.json.JSONObject
import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Button
import android.widget.EditText

/** Run only on a fresh dedicated test installation; never on an account's phone. */
@RunWith(AndroidJUnit4::class)
class ShareCaptureTest {
  @Test fun shareSheetHasOptionalChipsContextCounterAndTwoSentenceCaseActions() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, ShareActivity::class.java)
      .setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "https://youtube.com/shorts/ASkP2CRZOfc")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    try {
      instrumentation.runOnMainSync {
        fun descendants(view: View): List<View> = listOf(view) + if (view is ViewGroup)
          (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
        val views = descendants(activity.window.decorView)
        val labels = views.filterIsInstance<TextView>().map { it.text.toString() }
        assertTrue(labels.containsAll(listOf("Save to Mystash", "Product", "Place", "Both", "0/280")))
        assertEquals(listOf("Save", "Cancel"), views.filterIsInstance<Button>().map { it.text.toString() })
        assertEquals("Add context (optional)", views.filterIsInstance<EditText>().single().hint.toString())
        val chips = views.filter { it.contentDescription?.toString()?.endsWith(", not selected") == true }
        assertEquals(3, chips.size)
      }
    } finally { instrumentation.runOnMainSync { activity.finish() } }
  }
  @Test fun urlFixtures() {
    val context = InstrumentationRegistry.getInstrumentation().context
    val cases = JSONArray(context.assets.open("share-links.json").bufferedReader().use { it.readText() })
    for (i in 0 until cases.length()) {
      val row = cases.getJSONObject(i)
      assertEquals(row.getBoolean("ok"), ShareActivity.validatedUrl(row.getString("input")) != null)
    }
  }
  @Test fun privateOfflineCaptureSurvivesReadsAndCannotMoveBetweenAccounts() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    ShareStore.sync(context, null)
    val record = ShareStore.capture(context, "https://youtube.com/shorts/ASkP2CRZOfc", null)
    val id = record.getString("id")
    assertTrue(ShareStore.visible(context,null).any { it.getString("id") == id && it.isNull("owner") })
    val account = JSONObject().put("accountId", "fixture-a").put("expiresAt", 0)
    ShareStore.sync(context, account); ShareStore.claim(context, id, "fixture-a")
    ShareStore.sync(context, JSONObject().put("accountId", "fixture-b").put("expiresAt", 0))
    assertFalse(ShareStore.visible(context,"fixture-b").any { it.getString("id") == id })
    ShareStore.sync(context, account); ShareStore.discard(context, id, "fixture-a"); ShareStore.sync(context, null)
  }
  @Test fun imageEnvelopeIsEncryptedDeduplicatedOwnerBoundAndDoesNotRewritePendingUrls() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val account = JSONObject().put("accountId","fixture-images-a").put("expiresAt",0)
    ShareStore.sync(context,account)
    val url = ShareStore.enqueueUrl(context,"https://youtube.com/shorts/ASkP2CRZOfc","fixture-images-a")
    assertEquals(url.getString("id"),ShareStore.enqueueUrl(context,url.getString("url"),"fixture-images-a").getString("id"))
    val file = java.io.File.createTempFile("find-image-fixture-",".jpg",context.cacheDir)
    val canary = "PRIVATE_IMAGE_FIXTURE_NEVER_PERSIST_IN_PLAINTEXT"
    file.writeBytes(byteArrayOf(0xff.toByte(),0xd8.toByte(),0xff.toByte()) + canary.toByteArray())
    val uri = android.net.Uri.fromFile(file).toString()
    try {
      val row = ShareStore.enqueueImage(context,uri,"gallery","fixture-images-a"); val id = row.getString("id")
      assertFalse(row.has("bytes"))
      assertEquals(id,ShareStore.enqueueImage(context,uri,"gallery","fixture-images-a").getString("id"))
      val persisted = java.io.File(context.noBackupFilesDir,"mystash-share/$id.image").readBytes().toString(Charsets.ISO_8859_1)
      assertFalse(persisted.contains(canary));assertFalse(persisted.contains(row.getString("sha256")))
      ShareStore.sync(context,JSONObject().put("accountId","fixture-images-b").put("expiresAt",0))
      assertTrue(ShareStore.listImages(context,"fixture-images-b").isEmpty())
      assertTrue(runCatching { ShareStore.imageBytes(context,id,"fixture-images-a") }.isFailure)
      ShareStore.sync(context,account)
      assertTrue(ShareStore.imageBytes(context,id,"fixture-images-a").isNotEmpty())
      assertTrue(ShareStore.visible(context,"fixture-images-a").any { it.getString("id") == url.getString("id") })
      ShareStore.updateImage(context,id,"fixture-images-a",JSONObject().put("state","accepted").put("importId",java.util.UUID.randomUUID().toString()))
      assertTrue(runCatching { ShareStore.imageBytes(context,id,"fixture-images-a") }.isFailure)
      ShareStore.removeImage(context,id,"fixture-images-a");ShareStore.discard(context,url.getString("id"),"fixture-images-a")
    } finally { file.delete();ShareStore.sync(context,null) }
  }
}
