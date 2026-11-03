import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController, UITextViewDelegate {
  private var url: String?
  private var selectedKind: String?
  private var choiceButtons: [UIButton] = []
  private var palette: [String: String] = [:]
  private var glyphs: [String: Int] = [:]
  private var bodyFont = UIFont.preferredFont(forTextStyle: .body)
  private var chipFont = UIFont.preferredFont(forTextStyle: .caption1)
  private let message = UILabel(), note = UITextView(), save = UIButton(type: .system), cancel = UIButton(type: .system)
  private let placeholder = UILabel(), counter = UILabel()
  private func color(_ key: String) -> UIColor {
    guard let value = palette[key] else { return .label }
    if value.hasPrefix("rgba(") {
      let values = value.dropFirst(5).dropLast().split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
      if values.count == 4 { return UIColor(red: CGFloat(values[0])/255, green: CGFloat(values[1])/255, blue: CGFloat(values[2])/255, alpha: CGFloat(values[3])) }
    }
    guard let rgb = UInt32(value.dropFirst(), radix: 16) else { return .label }
    return UIColor(red: CGFloat((rgb >> 16) & 255)/255, green: CGFloat((rgb >> 8) & 255)/255, blue: CGFloat(rgb & 255)/255, alpha: 1)
  }
  private func glyph(_ name: String) -> String {
    guard let code = glyphs[name], let scalar = UnicodeScalar(code) else { return "" }
    return String(scalar)
  }
  override func viewDidLoad() {
    super.viewDidLoad()
    let themeURL = Bundle.main.url(forResource: "share-theme", withExtension: "json")
    let themes = themeURL.flatMap { try? Data(contentsOf: $0) }.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    let mode = themes["defaultMode"] as? String ?? "titanium"
    let theme = themes[mode] as? [String: Any] ?? [:]
    palette = theme["color"] as? [String: String] ?? [:]; glyphs = themes["icons"] as? [String: Int] ?? [:]
    let sizes = theme["fontSize"] as? [String: Double] ?? [:], space = theme["space"] as? [String: Double] ?? [:]
    let radii = theme["radius"] as? [String: Double] ?? [:], stroke = theme["stroke"] as? [String: Double] ?? [:]
    func gap(_ key: String) -> CGFloat { CGFloat(space[key] ?? 0) }
    func font(_ role: String, face: String = "Inter-Regular") -> UIFont {
      UIFontMetrics(forTextStyle: role == "headline" ? .headline : .body).scaledFont(for: UIFont(name: face, size: CGFloat(sizes[role] ?? 15)) ?? .preferredFont(forTextStyle: .body))
    }
    bodyFont = font("body"); chipFont = font("caption", face: "Inter-SemiBold")
    func label(_ value: String, role: String = "body", muted: Bool = false) -> UILabel {
      let result = UILabel(); result.text = value; result.font = font(role); result.numberOfLines = 0
      result.textColor = color(muted ? "textMuted" : "text"); result.adjustsFontForContentSizeCategory = true
      return result
    }
    func icon(_ name: String, foreground: UIColor) -> UILabel {
      let result = UILabel(); result.text = glyph(name); result.font = UIFont(name: "Ionicons", size: gap("lg"))
      result.textColor = foreground; result.textAlignment = .center; result.isAccessibilityElement = false
      return result
    }
    overrideUserInterfaceStyle = mode == "titanium" ? .light : .dark
    view.backgroundColor = color("text").withAlphaComponent(0.55)
    let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false; scroll.keyboardDismissMode = .interactive
    view.addSubview(scroll)
    NSLayoutConstraint.activate([scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor), scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)])
    let viewport = UIView(); viewport.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(viewport)
    NSLayoutConstraint.activate([viewport.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor), viewport.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
      viewport.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor), viewport.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
      viewport.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor), viewport.heightAnchor.constraint(greaterThanOrEqualTo: scroll.frameLayoutGuide.heightAnchor)])
    let preferredHeight = viewport.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor)
    preferredHeight.priority = .defaultLow; preferredHeight.isActive = true
    let card = UIStackView(); card.axis = .vertical; card.spacing = gap("sm"); card.translatesAutoresizingMaskIntoConstraints = false
    card.isLayoutMarginsRelativeArrangement = true; card.layoutMargins = UIEdgeInsets(top: gap("lg"), left: gap("lg"), bottom: gap("lg"), right: gap("lg"))
    card.backgroundColor = color("canvas"); card.layer.cornerRadius = CGFloat(radii["xxl"] ?? 22)
    viewport.addSubview(card)
    let center = card.centerYAnchor.constraint(equalTo: viewport.centerYAnchor); center.priority = .defaultHigh
    let preferredWidth = card.widthAnchor.constraint(equalTo: viewport.widthAnchor, constant: -2 * gap("lg")); preferredWidth.priority = .defaultHigh
    NSLayoutConstraint.activate([card.centerXAnchor.constraint(equalTo: viewport.centerXAnchor), center, preferredWidth,
      card.widthAnchor.constraint(lessThanOrEqualToConstant: gap("xxl") * 8), card.leadingAnchor.constraint(greaterThanOrEqualTo: viewport.leadingAnchor, constant: gap("lg")),
      card.topAnchor.constraint(greaterThanOrEqualTo: viewport.topAnchor, constant: gap("lg")), card.bottomAnchor.constraint(lessThanOrEqualTo: viewport.bottomAnchor, constant: -gap("lg"))])
    let brandRow = UIStackView(); brandRow.alignment = .center; brandRow.axis = .vertical
    let badge = UIView(); badge.backgroundColor = color("primary"); badge.layer.cornerRadius = CGFloat(radii["lg"] ?? 16)
    let mark = icon("layers-outline", foreground: color("onPrimary")); mark.translatesAutoresizingMaskIntoConstraints = false; badge.addSubview(mark)
    NSLayoutConstraint.activate([badge.widthAnchor.constraint(equalToConstant: gap("xxl")), badge.heightAnchor.constraint(equalTo: badge.widthAnchor), mark.centerXAnchor.constraint(equalTo: badge.centerXAnchor), mark.centerYAnchor.constraint(equalTo: badge.centerYAnchor)])
    brandRow.addArrangedSubview(badge); card.addArrangedSubview(brandRow)
    let title = label("Save to Mystash", role: "headline"); title.font = font("headline", face: "Inter-Bold"); title.textAlignment = .center; title.accessibilityTraits.insert(.header)
    card.addArrangedSubview(title)
    message.text = "Preparing your link…"; message.numberOfLines = 0; message.font = bodyFont; message.textColor = color("textMuted"); message.textAlignment = .center; message.adjustsFontForContentSizeCategory = true
    card.addArrangedSubview(message)
    let minimum = CGFloat(theme["minimumHitTarget"] as? Double ?? 44)
    let choices = UIStackView(); choices.axis = .horizontal; choices.distribution = .fillEqually; choices.spacing = gap("xs")
    for (index, name) in ["Product", "Place", "Both"].enumerated() {
      let button = UIButton(type: .custom); button.tag = index; button.accessibilityLabel = name
      button.layer.cornerRadius = CGFloat(radii["lg"] ?? 16); button.layer.borderWidth = CGFloat(stroke["thin"] ?? 1)
      button.heightAnchor.constraint(greaterThanOrEqualToConstant: minimum).isActive = true
      button.addTarget(self, action: #selector(selectChoice(_:)), for: .touchUpInside)
      choiceButtons.append(button); choices.addArrangedSubview(button)
    }
    refreshChoices()
    let noteBox = UIStackView(); noteBox.axis = .vertical; noteBox.backgroundColor = color("surface")
    noteBox.layer.cornerRadius = CGFloat(radii["lg"] ?? 16); noteBox.layer.borderColor = color("border").cgColor; noteBox.layer.borderWidth = CGFloat(stroke["thin"] ?? 1)
    let input = UIView(); note.translatesAutoresizingMaskIntoConstraints = false; placeholder.translatesAutoresizingMaskIntoConstraints = false
    input.addSubview(note); input.addSubview(placeholder)
    note.delegate = self; note.font = bodyFont; note.textColor = color("text"); note.backgroundColor = .clear; note.adjustsFontForContentSizeCategory = true
    note.textContainerInset = UIEdgeInsets(top: gap("sm"), left: gap("xs"), bottom: gap("xs"), right: gap("xs")); note.autocorrectionType = .no
    note.accessibilityLabel = "Add context, optional, up to 280 characters"
    placeholder.text = "Add context (optional)"; placeholder.font = bodyFont; placeholder.textColor = color("textMuted"); placeholder.isAccessibilityElement = false
    NSLayoutConstraint.activate([note.leadingAnchor.constraint(equalTo: input.leadingAnchor), note.trailingAnchor.constraint(equalTo: input.trailingAnchor), note.topAnchor.constraint(equalTo: input.topAnchor), note.bottomAnchor.constraint(equalTo: input.bottomAnchor),
      input.heightAnchor.constraint(equalToConstant: gap("xxl") + gap("lg")), placeholder.leadingAnchor.constraint(equalTo: input.leadingAnchor, constant: gap("sm")), placeholder.topAnchor.constraint(equalTo: input.topAnchor, constant: gap("sm")), placeholder.trailingAnchor.constraint(lessThanOrEqualTo: input.trailingAnchor, constant: -gap("sm"))])
    noteBox.addArrangedSubview(input)
    let divider = UIView(); divider.backgroundColor = color("divider"); divider.heightAnchor.constraint(equalToConstant: CGFloat(stroke["hairline"] ?? 1)).isActive = true; noteBox.addArrangedSubview(divider)
    let footer = UIStackView(); footer.axis = .horizontal; footer.spacing = gap("xs"); footer.alignment = .top
    footer.isLayoutMarginsRelativeArrangement = true; footer.layoutMargins = UIEdgeInsets(top: gap("xs"), left: gap("sm"), bottom: gap("xs"), right: gap("sm"))
    footer.addArrangedSubview(label("e.g. looking for the laptop, not the desk", role: "micro", muted: true))
    counter.text = "0/280"; counter.font = font("micro"); counter.textColor = color("textMuted"); counter.setContentCompressionResistancePriority(.required, for: .horizontal); footer.addArrangedSubview(counter); noteBox.addArrangedSubview(footer)
    if Bundle.main.object(forInfoDictionaryKey: "MystashShareIntentEnabled") as? Bool == true {
      card.setCustomSpacing(gap("lg"), after: message); card.addArrangedSubview(choices); card.setCustomSpacing(gap("md"), after: choices); card.addArrangedSubview(noteBox)
    }
    let notice = UIStackView(); notice.axis = .horizontal; notice.spacing = gap("xs"); notice.alignment = .center
    notice.isLayoutMarginsRelativeArrangement = true; notice.layoutMargins = UIEdgeInsets(top: gap("sm"), left: gap("sm"), bottom: gap("sm"), right: gap("sm"))
    notice.backgroundColor = color("surfaceSubtle"); notice.layer.cornerRadius = CGFloat(radii["lg"] ?? 16)
    let info = icon("information-circle-outline", foreground: color("textMuted")); info.widthAnchor.constraint(equalToConstant: gap("lg")).isActive = true
    notice.addArrangedSubview(info); notice.addArrangedSubview(label("Runs in the background — you can continue browsing while Mystash finds results.", role: "caption", muted: true)); card.addArrangedSubview(notice)
    for (button, name, primary) in [(save, "Save", true), (cancel, "Cancel", false)] {
      button.setTitle(name, for: .normal); button.titleLabel?.font = font("title", face: "Inter-SemiBold"); button.titleLabel?.adjustsFontForContentSizeCategory = true
      button.backgroundColor = color(primary ? "primary" : "surface"); button.setTitleColor(color(primary ? "onPrimary" : "text"), for: .normal)
      button.layer.cornerRadius = CGFloat(radii["lg"] ?? 16); button.layer.borderColor = color("border").cgColor; button.layer.borderWidth = primary ? 0 : CGFloat(stroke["thin"] ?? 1)
      button.heightAnchor.constraint(greaterThanOrEqualToConstant: minimum + gap("xs")).isActive = true; card.addArrangedSubview(button)
    }
    card.setCustomSpacing(gap("lg"), after: notice)
    save.isEnabled = false; save.alpha = 0.5; save.addTarget(self, action: #selector(saveLink), for: .touchUpInside)
    cancel.addTarget(self, action: #selector(close), for: .touchUpInside)
    loadSharedLink()
  }
  @objc private func selectChoice(_ sender: UIButton) {
    let kind = ["product", "place", "both"][sender.tag]; selectedKind = selectedKind == kind ? nil : kind; refreshChoices()
  }
  private func refreshChoices() {
    for button in choiceButtons {
      let selected = selectedKind == ["product", "place", "both"][button.tag]
      let foreground = color(selected ? "onPrimary" : "text")
      button.isSelected = selected; button.backgroundColor = color(selected ? "primary" : "surface"); button.layer.borderColor = color(selected ? "primary" : "border").cgColor
      let names = button.tag == 0 ? ["cube-outline"] : button.tag == 1 ? ["location-outline"] : ["cube-outline", "location-outline"]
      let title = NSMutableAttributedString(string: names.map(glyph).joined(), attributes: [.font: UIFont(name: "Ionicons", size: chipFont.pointSize + 5) ?? chipFont, .foregroundColor: foreground])
      title.append(NSAttributedString(string: " " + ["Product", "Place", "Both"][button.tag], attributes: [.font: chipFont, .foregroundColor: foreground]))
      button.setAttributedTitle(title, for: .normal); button.accessibilityValue = selected ? "Selected" : "Not selected"
    }
  }
  private func loadSharedLink() {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    guard let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) || $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) else { message.text = "That share does not contain a web link."; return }
    let type = provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) ? UTType.url.identifier : UTType.plainText.identifier
    provider.loadItem(forTypeIdentifier: type, options: nil) { value, _ in
      let raw = (value as? URL)?.absoluteString ?? (value as? String) ?? (value as? NSAttributedString)?.string ?? (value as? Data).flatMap { String(data: $0, encoding: .utf8) } ?? ""
      let parsed = Self.validatedURL(raw)
      DispatchQueue.main.async { self.url = parsed; self.save.isEnabled = parsed != nil; self.save.alpha = parsed == nil ? 0.5 : 1
        self.message.text = parsed == nil ? "That share does not contain a supported web link." : "Mystash will find products and places in the background." }
    }
  }
  func textViewDidChange(_ textView: UITextView) { placeholder.isHidden = !textView.text.isEmpty; counter.text = "\(textView.text.unicodeScalars.count)/280" }
  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    guard let r = Range(range, in: textView.text) else { return false }
    return textView.text.replacingCharacters(in: r, with: text).unicodeScalars.count <= 280
  }
  @objc private func saveLink() {
    guard let url else { return }; save.isEnabled = false; save.setTitle("Saving…", for: .normal); cancel.isEnabled = false
    let kind = selectedKind
    let text = note.text.trimmingCharacters(in: .whitespacesAndNewlines)
    let intent: [String: Any]? = kind != nil || !text.isEmpty ? ["kind": kind as Any? ?? NSNull(), "note": text.isEmpty ? NSNull() : text as Any] : nil
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        try ShareCore.shared.capture(url: url, intent: intent)
        try? ShareCore.shared.deliver()
        DispatchQueue.main.async { self.message.text = "Saved on this device — pending upload"; UIAccessibility.post(notification: .announcement, argument: self.message.text)
          self.extensionContext?.completeRequest(returningItems: nil) }
      } catch { DispatchQueue.main.async { self.message.text = "Could not save. Keep this link and try again."; self.save.isEnabled = true; self.save.setTitle("Save", for: .normal); self.cancel.isEnabled = true } }
    }
  }
  @objc private func close() { extensionContext?.completeRequest(returningItems: nil) }
  static func validatedURL(_ raw: String) -> String? {
    return ShareCore.validatedURL(raw)
  }
}
