package expo.modules.mystashshare

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import androidx.work.WorkManager

class MystashShareModule : Module() {
  private fun context() = appContext.reactContext ?: error("Share context unavailable")
  override fun definition() = ModuleDefinition {
    Name("MystashShare")
    AsyncFunction("syncSession") { value: Map<String, Any?>? ->
      val c = context()
      WorkManager.getInstance(c).cancelUniqueWork("mystash-share-delivery")
      ShareStore.sync(c, value?.let { JSONObject(it) })
      if (value != null) ShareDelivery.schedule(c)
    }
    AsyncFunction("listPending") { expectedOwner: String? -> ShareStore.visible(context(),expectedOwner).map { record ->
      record.keys().asSequence().associateWith { key -> if (record.isNull(key)) null else record.get(key).let { if (it is JSONObject) it.toString() else it } }
    } }
    AsyncFunction("claim") { id: String, expectedOwner: String -> ShareStore.claim(context(), id,expectedOwner); try { ShareDelivery.schedule(context()) } catch (_: Exception) { /* Already durable. */ } }
    AsyncFunction("discard") { id: String, expectedOwner: String? -> ShareStore.discard(context(), id,expectedOwner) }
    AsyncFunction("retry") { expectedOwner: String -> ShareStore.retry(context(),expectedOwner); ShareDelivery.schedule(context()) }
  }
}
