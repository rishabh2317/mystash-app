package expo.modules.mystashshare

import android.app.Activity
import android.os.Bundle
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.Editable
import android.text.InputFilter
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.*
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.Executors

/** Native presentation only. Durable capture and delivery remain in their existing services. */
class ShareActivity : Activity() {
  private val executor = Executors.newSingleThreadExecutor()
  override fun onDestroy() { executor.shutdown(); super.onDestroy() }
  private fun resource(name: String) = resources.getIdentifier(name, "string", packageName).let { if (it == 0) "" else getString(it) }
  private fun dp(value: Double) = (value * resources.displayMetrics.density).toInt()
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val clip = intent?.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)
    val url = listOf(intent?.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(), clip?.text?.toString(),
      clip?.uri?.toString(), intent?.getStringExtra(Intent.EXTRA_SUBJECT)).filterNotNull().mapNotNull { validatedUrl(it) }.firstOrNull()
    val themes = JSONObject(assets.open("mystash-share/share-theme.json").bufferedReader().use { it.readText() })
    // Match Mystash's default Titanium presentation, rather than the source app's OS theme.
    val theme = themes.getJSONObject(themes.getString("defaultMode"))
    val colors = theme.getJSONObject("color"); val sizes = theme.getJSONObject("fontSize")
    val space = theme.getJSONObject("space"); val radii = theme.getJSONObject("radius")
    fun s(key: String) = dp(space.getDouble(key))
    fun color(key: String) = nativeColor(colors.getString(key))
    val regular = Typeface.createFromAsset(assets, "mystash-share/Inter-Regular.ttf")
    val semibold = Typeface.createFromAsset(assets, "mystash-share/Inter-SemiBold.ttf")
    val bold = Typeface.createFromAsset(assets, "mystash-share/Inter-Bold.ttf")
    val iconFont = Typeface.createFromAsset(assets, "mystash-share/Ionicons.ttf")
    val minimum = dp(theme.getDouble("minimumHitTarget"))
    fun background(fill: Int, radius: String = "md", outlined: Boolean = false) = GradientDrawable().apply {
      setColor(fill); cornerRadius = dp(radii.getDouble(radius)).toFloat()
      if (outlined) setStroke(dp(theme.getJSONObject("stroke").getDouble("thin")).coerceAtLeast(1), color("border"))
    }
    fun text(value: String, role: String = "body", muted: Boolean = false) = TextView(this).apply {
      text = value; textSize = sizes.getDouble(role).toFloat(); typeface = regular
      setTextColor(color(if (muted) "textMuted" else "text")); includeFontPadding = false
    }
    fun icon(name: String, foreground: Int, size: Double = space.getDouble("lg")) = TextView(this).apply {
      text = String(Character.toChars(themes.getJSONObject("icons").getInt(name)))
      textSize = size.toFloat(); typeface = iconFont; gravity = Gravity.CENTER
      setTextColor(foreground); importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
      includeFontPadding = false
    }
    fun add(parent: LinearLayout, view: View, top: Int = 0) {
      parent.addView(view, LinearLayout.LayoutParams(-1, -2).apply { topMargin = top })
    }
    fun button(label: String, primary: Boolean) = Button(this).apply {
      text = label; isAllCaps = false; typeface = semibold; textSize = sizes.getDouble("title").toFloat()
      minHeight = minimum; minimumHeight = minimum; setPadding(s("md"), s("sm"), s("md"), s("sm"))
      backgroundTintList = null; stateListAnimator = null
      background = RippleDrawable(ColorStateList.valueOf(color("overlayPressed")),
        background(color(if (primary) "primary" else "surface"), "lg", !primary), null)
      setTextColor(color(if (primary) "onPrimary" else "text")); gravity = Gravity.CENTER
    }
    window.setBackgroundDrawableResource(android.R.color.transparent)
    window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
    window.attributes = window.attributes.apply { dimAmount = 0.55f }
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN)
    val scroll = ScrollView(this).apply { isFillViewport = true; clipToPadding = false
      setPadding(s("lg"), s("lg"), s("lg"), s("lg")); fitsSystemWindows = true }
    val centered = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; isFocusableInTouchMode = true }
    scroll.addView(centered, FrameLayout.LayoutParams(-1, -2))
    val content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL; setPadding(s("lg"), s("lg"), s("lg"), s("lg"))
      background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(color("canvas"), color("canvasEnd"))).apply {
        cornerRadius = dp(radii.getDouble("xxl")).toFloat()
      }; elevation = dp(space.getDouble("xs")).toFloat()
    }
    val width = minOf(dp(resources.configuration.screenWidthDp.toDouble()) - 2 * s("lg"), s("xxl") * 8)
    centered.addView(content, LinearLayout.LayoutParams(width, -2))
    val badge = FrameLayout(this).apply { background = background(color("primary"), "lg"); elevation = dp(space.getDouble("xxs")).toFloat() }
    badge.addView(icon("layers-outline", color("onPrimary")), FrameLayout.LayoutParams(-1, -1))
    content.addView(badge, LinearLayout.LayoutParams(s("xxl"), s("xxl")).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = s("sm") })
    val title = text("Save to Mystash", "headline").apply { typeface = bold; gravity = Gravity.CENTER; if (android.os.Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true }
    add(content, title)
    val message = text(if (url == null) "That share does not contain a supported web link." else "Mystash will find products and places in the background.", muted = true).apply { gravity = Gravity.CENTER }
    add(content, message, s("xs"))
    var selectedKind: String? = null
    val chips = mutableListOf<Pair<LinearLayout, String>>()
    val choices = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; isBaselineAligned = false }
    fun updateChoices() {
      for ((chip, kind) in chips) {
        val selected = selectedKind == kind; chip.isSelected = selected
        chip.background = background(color(if (selected) "primary" else "surface"), "lg", !selected)
        chip.contentDescription = kind.replaceFirstChar { it.uppercase() } + if (selected) ", selected" else ", not selected"
        for (i in 0 until chip.childCount) (chip.getChildAt(i) as? TextView)?.setTextColor(color(if (selected) "onPrimary" else "text"))
      }
    }
    listOf("product" to "cube-outline", "place" to "location-outline", "both" to "cube-outline").forEachIndexed { i, (kind, glyph) ->
      val chip = object : LinearLayout(this) {
        override fun onInitializeAccessibilityNodeInfo(info: android.view.accessibility.AccessibilityNodeInfo) {
          super.onInitializeAccessibilityNodeInfo(info); info.className = "android.widget.ToggleButton"; info.isCheckable = true; info.isChecked = isSelected
        }
      }.apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; minimumHeight = minimum
        isClickable = true; isFocusable = true; setPadding(s("xxs"), s("xs"), s("xxs"), s("xs")) }
      chip.addView(icon(glyph, color("text"), space.getDouble("md") + space.getDouble("xxs")))
      if (kind == "both") chip.addView(icon("location-outline", color("text"), space.getDouble("md")))
      chip.addView(text(kind.replaceFirstChar { it.uppercase() }, "caption").apply { typeface = semibold }, LinearLayout.LayoutParams(-2, -2).apply { marginStart = s("xxs") })
      chips.add(chip to kind); chip.setOnClickListener { selectedKind = if (selectedKind == kind) null else kind; updateChoices() }
      choices.addView(chip, LinearLayout.LayoutParams(0, -2, 1f).apply { if (i > 0) marginStart = s("xs") })
    }
    updateChoices()
    val intentEnabled = resource("mystash_share_intent_enabled") == "true"
    val note = EditText(this).apply {
      hint = "Add context (optional)"; typeface = regular; textSize = sizes.getDouble("body").toFloat()
      setTextColor(color("text")); setHintTextColor(color("textMuted")); background = null
      gravity = Gravity.TOP; setPadding(s("sm"), s("sm"), s("sm"), s("xs")); minLines = 2; maxLines = 3
      filters = arrayOf(InputFilter.LengthFilter(280)); inputType = 147457; isSaveEnabled = false
      contentDescription = "Add context, optional, up to 280 characters"
    }
    val noteBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; background = background(color("surface"), "lg", true) }
    add(noteBox, note)
    val divider = View(this).apply { setBackgroundColor(color("divider")) }
    noteBox.addView(divider, LinearLayout.LayoutParams(-1, dp(theme.getJSONObject("stroke").getDouble("hairline")).coerceAtLeast(1)).apply { marginStart = s("sm"); marginEnd = s("sm") })
    val footer = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.TOP; setPadding(s("sm"), s("xs"), s("sm"), s("xs")) }
    footer.addView(text("e.g. looking for the laptop, not the desk", "micro", true), LinearLayout.LayoutParams(0, -2, 1f))
    val counter = text("0/280", "micro", true).apply { gravity = Gravity.END }
    footer.addView(counter, LinearLayout.LayoutParams(-2, -2).apply { marginStart = s("xs") }); add(noteBox, footer)
    note.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
      override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { counter.text = "${s?.length ?: 0}/280" }
      override fun afterTextChanged(s: Editable?) {}
    })
    if (intentEnabled) { add(content, choices, s("lg")); add(content, noteBox, s("md")) }
    val notice = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
      background = background(color("surfaceSubtle"), "lg"); setPadding(s("sm"), s("sm"), s("sm"), s("sm")) }
    notice.addView(icon("information-circle-outline", color("textMuted"), space.getDouble("lg")))
    notice.addView(text("Runs in the background — you can continue browsing while Mystash finds results.", "caption", true), LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = s("xs") })
    add(content, notice, s("md"))
    val save = button("Save", true).apply { isEnabled = url != null; alpha = if (isEnabled) 1f else 0.5f }
    val cancel = button("Cancel", false).apply { setOnClickListener { finish() } }
    save.setOnClickListener {
      save.isEnabled = false; save.text = "Saving…"; cancel.isEnabled = false; note.isEnabled = false; chips.forEach { it.first.isEnabled = false }
      val context = if (intentEnabled && (selectedKind != null || note.text.toString().isNotBlank())) JSONObject().put("kind", selectedKind ?: JSONObject.NULL).put("note", note.text.toString().trim().ifEmpty { null } ?: JSONObject.NULL) else null
      executor.execute {
        try {
          ShareStore.capture(applicationContext, url!!, context)
          try { ShareDelivery.schedule(applicationContext) } catch (_: Exception) { /* Durable local recovery remains available. */ }
          runOnUiThread { Toast.makeText(this, "Saved on this device — pending upload", Toast.LENGTH_SHORT).show(); finish() }
        } catch (_: Exception) {
          runOnUiThread { message.text = "Could not save. Keep this link and try again."; message.setTextColor(color("danger"))
            save.isEnabled = true; save.text = "Save"; cancel.isEnabled = true; note.isEnabled = true; chips.forEach { it.first.isEnabled = true } }
        }
      }
    }
    add(content, save, s("lg")); add(content, cancel, s("xs"))
    if (android.os.Build.VERSION.SDK_INT >= 29) scroll.isForceDarkAllowed = false
    setContentView(scroll); window.setLayout(-1, -1); centered.requestFocus()
  }
  private fun nativeColor(value: String): Int {
    if (!value.startsWith("rgba(")) return Color.parseColor(value)
    val channels = value.removePrefix("rgba(").removeSuffix(")").split(',').map { it.trim().toDouble() }
    return Color.argb((channels[3] * 255).toInt(), channels[0].toInt(), channels[1].toInt(), channels[2].toInt())
  }
  companion object {
    fun validatedUrl(raw: String): String? {
      if (raw.length > 4000) return null
      val token = Regex("https?://[^\\s]+", RegexOption.IGNORE_CASE).find(raw)?.value?.trimEnd('.', ',', '!', '?', ';', '\'', '"', ')', ']', '}') ?: return null
      return try {
        val uri = URI(token); val host = uri.host?.lowercase()?.trimEnd('.') ?: return null
        if (uri.userInfo != null || host == "localhost" || !host.contains('.') || host.startsWith("[") || Regex("^[0-9.]+$").matches(host) || listOf(".local", ".localhost", ".internal", ".lan", ".home.arpa").any { host.endsWith(it) }) null else token
      } catch (_: Exception) { null }
    }
  }
}
