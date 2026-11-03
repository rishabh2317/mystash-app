import Foundation
import CryptoKit
import Security
import Darwin

enum ShareFailure: Error { case storage, authentication, invalid, capacity }

/** Shared by the extension and app; never imports React/Expo or logs payloads. */
final class ShareCore: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
  static let shared = ShareCore()
  private var backgroundFinished: [String: () -> Void] = [:]
  private var restoredSessions: [String: URLSession] = [:]
  private var responses: [String: Data] = [:]
  private let responseLock = NSLock()
  private var ownIdentifier: String { "mystash.share.\(Bundle.main.bundleURL.pathExtension == "appex" ? "extension" : "app").v1" }
  static func retryAfter(_ header: String?, now: Date = Date()) -> TimeInterval {
    guard let header else { return 0 }
    if let seconds = Double(header), seconds.isFinite { return max(0, seconds) }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
    return max(0, formatter.date(from: header)?.timeIntervalSince(now) ?? 0)
  }
  static func validatedURL(_ raw: String) -> String? {
    guard raw.utf16.count <= 4000, let range = raw.range(of: "https?://[^\\s]+", options: [.regularExpression, .caseInsensitive]) else { return nil }
    let token = String(raw[range]).trimmingCharacters(in: CharacterSet(charactersIn: ".,!?;:'\"“”’)]}>|"))
    guard let url = URLComponents(string: token), let host = url.host?.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".")),
      ["http","https"].contains(url.scheme?.lowercased() ?? ""), url.user == nil, url.password == nil, host.contains("."), host != "localhost", !host.contains(":"),
      host.range(of: "^[0-9.]+$", options: .regularExpression) == nil,
      ![".local", ".localhost", ".internal", ".lan", ".home.arpa"].contains(where: { host.hasSuffix($0) }) else { return nil }
    return token
  }
  private var session: URLSession {
    responseLock.lock(); defer { responseLock.unlock() }
    if let existing = restoredSessions[ownIdentifier] { return existing }
    let config = URLSessionConfiguration.background(withIdentifier: ownIdentifier)
    config.sharedContainerIdentifier = Bundle.main.object(forInfoDictionaryKey: "MystashShareAppGroup") as? String
    config.timeoutIntervalForRequest = 15; config.timeoutIntervalForResource = 120
    config.httpMaximumConnectionsPerHost = 1
    let created = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    restoredSessions[ownIdentifier] = created
    return created
  }
  private func directory() throws -> URL {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "MystashShareAppGroup") as? String,
      let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { throw ShareFailure.storage }
    var dir = base.appendingPathComponent("mystash-share", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    var values = URLResourceValues(); values.isExcludedFromBackup = true; try dir.setResourceValues(values)
    return dir
  }
  private func locked<T>(_ work: () throws -> T) throws -> T {
    let fd = open(try directory().appendingPathComponent("lock").path, O_CREAT | O_RDWR, 0o600)
    guard fd >= 0 else { throw ShareFailure.storage }; defer { close(fd) }
    guard flock(fd, LOCK_EX) == 0 else { throw ShareFailure.storage }; defer { flock(fd, LOCK_UN) }
    return try work()
  }
  private func key() throws -> SymmetricKey {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "MystashShareKeychainGroup") as? String else { throw ShareFailure.storage }
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "mystash.share.v1", kSecAttrAccount as String: "storage",
      kSecAttrAccessGroup as String: group]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query.merging([kSecReturnData as String: true]) { _, b in b } as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data { return SymmetricKey(data: data) }
    guard status == errSecItemNotFound else { throw ShareFailure.storage }
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw ShareFailure.storage }
    let data = Data(bytes)
    let added = SecItemAdd(query.merging([kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]) { _, b in b } as CFDictionary, nil)
    guard added == errSecSuccess else { throw ShareFailure.storage }
    return SymmetricKey(data: data)
  }
  private func read(_ name: String) throws -> [String: Any]? {
    let url = try directory().appendingPathComponent(name)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    let box = try AES.GCM.SealedBox(combined: Data(contentsOf: url))
    let data = try AES.GCM.open(box, using: key())
    guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ShareFailure.storage }
    return value
  }
  private func write(_ name: String, _ value: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    guard let encrypted = try AES.GCM.seal(data, using: key()).combined else { throw ShareFailure.storage }
    let url = try directory().appendingPathComponent(name)
    try encrypted.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }
  private func all() throws -> [[String: Any]] {
    try FileManager.default.contentsOfDirectory(at: directory(), includingPropertiesForKeys: nil)
      .filter { $0.pathExtension == "share" }.compactMap { try read($0.lastPathComponent) }
  }
  func syncSession(_ value: [String: Any]?) throws {
    let previous = try locked { try read("session")?["accountId"] as? String }
    try locked {
      if let value {
        try write("session", value)
        for var record in try all() where record["owner"] as? String == value["accountId"] as? String && record["state"] as? String == "needs_auth" {
          record["state"] = "pending"; try write("\(record["id"]!).share", record)
        }
      }
      else { let url = try directory().appendingPathComponent("session"); if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) } }
    }
    if previous != value?["accountId"] as? String {
      session.getAllTasks { tasks in
        for task in tasks {
          guard let id = task.taskDescription else { continue }
          let owned = try? self.locked { try self.read("\(id).share")?["owner"] as? String }
          if owned == previous { task.cancel() }
        }
      }
    }
    if value != nil { try deliver() }
  }
  func restore(_ identifier: String, completion: @escaping () -> Void) {
    responseLock.lock()
    backgroundFinished[identifier] = completion
    responseLock.unlock()
    if identifier == ownIdentifier { _ = session; return }
    responseLock.lock(); defer { responseLock.unlock() }
    if restoredSessions[identifier] != nil { return }
    let config = URLSessionConfiguration.background(withIdentifier: identifier)
    config.sharedContainerIdentifier = Bundle.main.object(forInfoDictionaryKey: "MystashShareAppGroup") as? String
    restoredSessions[identifier] = URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }
  func retryPending(_ expectedOwner: String) throws {
    try locked {
      guard let owner = try read("session")?["accountId"] as? String else { return }
      guard owner == expectedOwner else { throw ShareFailure.authentication }
      for var record in try all() where record["owner"] as? String == owner && ["needs_auth","needs_review"].contains(record["state"] as? String ?? "") {
        record["state"] = "pending"; record["attempts"] = 0; record["notBefore"] = 0; record["leaseUntil"] = 0
        try write("\(record["id"]!).share",record)
      }
    }; try deliver()
  }
  func capture(url: String, intent: [String: Any]?) throws {
    try locked {
      guard try all().count < 500 else { throw ShareFailure.capacity }
      var record: [String: Any] = ["id": UUID().uuidString.lowercased(), "url": url,
        "owner": try read("session")?["accountId"] ?? NSNull(), "state": "pending",
        "createdAt": Date().timeIntervalSince1970 * 1000]
      if let intent { record["intent"] = intent }
      try write("\(record["id"]!).share", record)
    }
  }
  func listPending(_ expectedOwner: String? = nil) throws -> [[String: Any]] {
    try locked {
      let owner = try read("session")?["accountId"] as? String
      guard owner == expectedOwner else { throw ShareFailure.authentication }
      return try all().filter { $0["owner"] is NSNull || (owner != nil && $0["owner"] as? String == owner) }
    }
  }
  func claim(_ id: String, _ expectedOwner: String) throws {
    guard UUID(uuidString: id) != nil else { throw ShareFailure.invalid }
    try locked {
      guard let owner = try read("session")?["accountId"] as? String, owner == expectedOwner,
        var record = try read("\(id).share"), record["owner"] is NSNull else { throw ShareFailure.authentication }
      record["owner"] = owner; record["state"] = "pending"; try write("\(id).share", record)
    }; try deliver()
  }
  func discard(_ id: String, _ expectedOwner: String?) throws {
    guard UUID(uuidString: id) != nil else { throw ShareFailure.invalid }
    try locked {
      guard let record = try read("\(id).share") else { return }
      let owner = try read("session")?["accountId"] as? String
      guard owner == expectedOwner else { throw ShareFailure.authentication }
      guard record["owner"] is NSNull || (owner != nil && record["owner"] as? String == owner) else { throw ShareFailure.authentication }
      try FileManager.default.removeItem(at: directory().appendingPathComponent("\(id).share"))
    }
  }
  func deliver() throws {
    let work: [([String: Any], [String: Any])] = try locked {
      guard let auth = try read("session"), let owner = auth["accountId"] as? String,
        let expiry = auth["expiresAt"] as? Double, expiry > Date().timeIntervalSince1970 + 30 else { return [] }
      let now = Date().timeIntervalSince1970
      return try all().filter { $0["owner"] as? String == owner && $0["state"] as? String == "pending" && ($0["leaseUntil"] as? Double ?? 0) < now }
        .prefix(25).map { row in
          var record = row; record["leaseUntil"] = max(now, record["notBefore"] as? Double ?? 0) + 300
          try write("\(record["id"]!).share", record); return (record, auth)
        }
    }
    for (record, auth) in work {
      // Serialize the final auth check and task scheduling with logout/account
      // changes in either process. A previously accepted request stays owned by
      // its original account; it must never be reassigned to the next account.
      try locked {
      guard let current = try read("session"),
        current["accountId"] as? String == auth["accountId"] as? String,
        current["accessToken"] as? String == auth["accessToken"] as? String else {
        if var pending = try read("\(record["id"]!).share") {
          pending["leaseUntil"] = 0; try write("\(record["id"]!).share", pending)
        }
        return
      }
      guard let id = record["id"] as? String, let base = auth["apiBase"] as? String,
        let target = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/imports/accept"),
        target.scheme == "https", target.user == nil, target.password == nil, target.query == nil,
        let token = auth["accessToken"] as? String else { throw ShareFailure.invalid }
      var body: [String: Any] = ["text": record["url"]!, "clientCaptureId": id]
      if let intent = record["intent"] { body["intent"] = intent }
      let upload = try directory().appendingPathComponent("\(id).upload")
      // URLSession requires a file body. OS Data Protection encrypts this transient
      // file; the directory is backup-excluded. It is removed on completion.
      try JSONSerialization.data(withJSONObject: body).write(to: upload, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      var request = URLRequest(url: target); request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      let task = session.uploadTask(with: request, fromFile: upload); task.taskDescription = id
      if let date = record["notBefore"] as? Double { task.earliestBeginDate = Date(timeIntervalSince1970: date) }
      task.resume()
      }
    }
  }
  // New encrypted envelopes do not rewrite or reinterpret legacy .share records.
  private func ownedImage(_ id: String, _ owner: String) throws -> [String: Any] {
    guard UUID(uuidString: id) != nil, try read("session")?["accountId"] as? String == owner,
      let record = try read("\(id).image"), record["owner"] as? String == owner else { throw ShareFailure.authentication }
    return record
  }
  private func images() throws -> [[String: Any]] {
    try FileManager.default.contentsOfDirectory(at: directory(), includingPropertiesForKeys: nil)
      .filter { $0.pathExtension == "image" }.compactMap { try read($0.lastPathComponent).map(imageSummary) }
  }
  private func imageSummary(_ record: [String: Any]) -> [String: Any] { var result = record; result.removeValue(forKey: "bytes"); return result }
  func enqueueUrl(_ raw: String, _ owner: String) throws -> [String: Any] {
    let record: [String: Any] = try locked {
      guard try read("session")?["accountId"] as? String == owner, let url = Self.validatedURL(raw) else { throw ShareFailure.authentication }
      if let previous = try all().first(where: { $0["owner"] as? String == owner && $0["url"] as? String == url && $0["state"] as? String != "intent_conflict" }) { return previous }
      guard try all().count < 500 else { throw ShareFailure.capacity }
      let row: [String: Any] = ["id": UUID().uuidString.lowercased(), "url": url, "owner": owner, "state": "pending", "createdAt": Date().timeIntervalSince1970 * 1000]
      try write("\(row["id"]!).share",row); return row
    }
    try? deliver(); return ["id": record["id"]!]
  }
  func enqueueImage(_ uri: String, _ origin: String, _ owner: String) throws -> [String: Any] {
    try locked {
      guard try read("session")?["accountId"] as? String == owner, ["camera","gallery"].contains(origin),
        let url = URL(string: uri), url.isFileURL,
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
        url.resolvingSymlinksInPath().path.hasPrefix(cache.resolvingSymlinksInPath().path + "/") else { throw ShareFailure.authentication }
      let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
      guard let size = attributes[.size] as? NSNumber, (1...5242880).contains(size.intValue) else { throw ShareFailure.invalid }
      let bytes = try Data(contentsOf: url)
      guard bytes.count <= 5242880, bytes.starts(with: [0xff,0xd8,0xff]) else { throw ShareFailure.invalid }
      let digest = SHA256.hash(data: bytes).map { String(format: "%02x",$0) }.joined()
      let existing = try images()
      if let row = existing.first(where: { $0["owner"] as? String == owner && $0["sha256"] as? String == digest && $0["state"] as? String != "accepted" }) { return imageSummary(row) }
      guard existing.count < 20 else { throw ShareFailure.capacity }
      let row: [String: Any] = ["version":1,"id":UUID().uuidString.lowercased(),"owner":owner,"origin":origin,"mime":"image/jpeg","sha256":digest,"size":bytes.count,"bytes":bytes.base64EncodedString(),"state":"pending","createdAt":Date().timeIntervalSince1970 * 1000,"attempts":0,"notBefore":0]
      try write("\(row["id"]!).image",row); return imageSummary(row)
    }
  }
  func listImages(_ owner: String) throws -> [[String: Any]] {
    try locked { guard try read("session")?["accountId"] as? String == owner else { throw ShareFailure.authentication }
      return try images().filter { $0["owner"] as? String == owner }.map(imageSummary) }
  }
  func imageBytes(_ id: String, _ owner: String) throws -> String {
    try locked { guard let bytes = try ownedImage(id,owner)["bytes"] as? String else { throw ShareFailure.invalid }; return bytes }
  }
  func updateImage(_ id: String, _ owner: String, _ patch: [String: Any]) throws {
    try locked {
      var row = try ownedImage(id,owner)
      guard patch.keys.allSatisfy({ ["state","attempts","notBefore","uploadId","importId"].contains($0) }) else { throw ShareFailure.invalid }
      if let state = patch["state"] as? String, !["pending","uploading","needs_auth","needs_review","accepted"].contains(state) { throw ShareFailure.invalid }
      for key in ["uploadId","importId"] { if let value = patch[key], UUID(uuidString: value as? String ?? "") == nil { throw ShareFailure.invalid } }
      row.merge(patch) { _, new in new }
      if row["state"] as? String == "accepted" { guard row["importId"] is String else { throw ShareFailure.invalid }; row.removeValue(forKey: "bytes") }
      try write("\(id).image",row)
    }
  }
  func removeImage(_ id: String, _ owner: String) throws { try locked { _ = try ownedImage(id,owner); try FileManager.default.removeItem(at: directory().appendingPathComponent("\(id).image")) } }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    responseLock.lock(); defer { responseLock.unlock() }
    let responseKey = "\(session.configuration.identifier ?? ""):\(dataTask.taskIdentifier)"
    var bytes = responses[responseKey] ?? Data()
    if bytes.count + data.count <= 16384 { bytes.append(data); responses[responseKey] = bytes }
    else { dataTask.cancel() }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let id = task.taskDescription, UUID(uuidString: id) != nil else { return }
    responseLock.lock(); let data = responses.removeValue(forKey: "\(session.configuration.identifier ?? ""):\(task.taskIdentifier)"); responseLock.unlock()
    let code = (task.response as? HTTPURLResponse)?.statusCode ?? 0
    let reply = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    do {
      try locked {
        defer { try? FileManager.default.removeItem(at: directory().appendingPathComponent("\(id).upload")) }
        guard var record = try read("\(id).share") else { return }
        if error == nil && (200...299).contains(code), reply?["protocolVersion"] as? Int == 2,
          reply?["delivery"] as? String == "accepted", let imported = reply?["importId"] as? String, UUID(uuidString: imported) != nil {
          if (reply?["intent"] as? [String: Any])?["state"] as? String == "conflict" {
            record["state"] = "intent_conflict"; record["importId"] = imported; try write("\(id).share", record)
          } else { try FileManager.default.removeItem(at: directory().appendingPathComponent("\(id).share")) }
        } else {
          record["leaseUntil"] = 0
          let attempts = (record["attempts"] as? Int ?? 0) + 1; record["attempts"] = attempts
          if code == 401 || code == 403 { record["state"] = "needs_auth" }
          else if attempts >= 12 || (400...499).contains(code) && ![404,429].contains(code) { record["state"] = "needs_review" }
          let retry = Self.retryAfter((task.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Retry-After"))
          record["notBefore"] = Date().timeIntervalSince1970 + max(retry, min(900, pow(2, Double(min(attempts, 8))) * 15)) + Double.random(in: 0...10)
          try write("\(id).share", record)
        }
      }
      try deliver()
    } catch { /* Preserve encrypted records. Recovery occurs on the next foreground/share. */ }
  }
  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    let identifier = session.configuration.identifier ?? ""
    responseLock.lock(); let done = backgroundFinished.removeValue(forKey: identifier); responseLock.unlock()
    DispatchQueue.main.async { done?() }
  }
}
