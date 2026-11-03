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
}
