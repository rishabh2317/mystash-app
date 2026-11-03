import XCTest
@testable import MystashShare

final class ShareCaptureTests: XCTestCase {
  func testRetryAfterSecondsAndHTTPDate() {
    let now = Date(timeIntervalSince1970: 0)
    XCTAssertEqual(ShareCore.retryAfter("60", now: now), 60)
    XCTAssertEqual(ShareCore.retryAfter("Thu, 01 Jan 1970 00:02:00 GMT", now: now), 120)
    XCTAssertEqual(ShareCore.retryAfter("invalid", now: now), 0)
    XCTAssertEqual(ShareCore.retryAfter("-1", now: now), 0)
  }
  func testSharedURLFixtures() throws {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "share-links", withExtension: "json"))
    let cases = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
    for row in cases { XCTAssertEqual(ShareCore.validatedURL(row["input"] as? String ?? "") != nil, row["ok"] as? Bool) }
  }
  func testPrivateCaptureAndAccountIsolation() throws {
    guard Bundle.main.object(forInfoDictionaryKey: "MystashShareAppGroup") != nil else {
      throw XCTSkip("Requires a dedicated native host with App Group and Keychain test entitlements")
    }
    let core = ShareCore.shared
    try core.syncSession(nil)
    try core.capture(url: "https://youtube.com/shorts/ASkP2CRZOfc", intent: nil)
    let record = try XCTUnwrap(core.listPending().first)
    let id = try XCTUnwrap(record["id"] as? String)
    try core.syncSession(["accountId":"fixture-a","expiresAt":0])
    try core.claim(id,"fixture-a")
    try core.syncSession(["accountId":"fixture-b","expiresAt":0])
    XCTAssertFalse(try core.listPending("fixture-b").contains { $0["id"] as? String == id })
    try core.syncSession(["accountId":"fixture-a","expiresAt":0])
    try core.discard(id,"fixture-a"); try core.syncSession(nil)
  }
  func testEncryptedImageEnvelopeAndLegacyURLCoexistence() throws {
    guard Bundle.main.object(forInfoDictionaryKey: "MystashShareAppGroup") != nil else { throw XCTSkip("Requires dedicated entitled native host") }
    let core = ShareCore.shared, owner = "fixture-images-a"
    let account: [String: Any] = ["accountId":owner,"expiresAt":0]
    try core.syncSession(account)
    let url = try core.enqueueUrl("https://youtube.com/shorts/ASkP2CRZOfc",owner)
    let urlID = try XCTUnwrap(url["id"] as? String)
    XCTAssertEqual(try core.enqueueUrl("https://youtube.com/shorts/ASkP2CRZOfc",owner)["id"] as? String,urlID)
    let cache = try XCTUnwrap(FileManager.default.urls(for: .cachesDirectory,in: .userDomainMask).first)
    let file = cache.appendingPathComponent("find-image-fixture-\(UUID()).jpg")
    let canary = "PRIVATE_IMAGE_FIXTURE_NEVER_PERSIST_IN_PLAINTEXT"
    try (Data([0xff,0xd8,0xff]) + Data(canary.utf8)).write(to:file)
    defer { try? FileManager.default.removeItem(at:file);try? core.syncSession(nil) }
    let row = try core.enqueueImage(file.absoluteString,"gallery",owner), id = try XCTUnwrap(row["id"] as? String)
    XCTAssertNil(row["bytes"])
    XCTAssertEqual(try core.enqueueImage(file.absoluteString,"gallery",owner)["id"] as? String,id)
    let group = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey:"MystashShareAppGroup") as? String)
    let base = try XCTUnwrap(FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:group))
    let persisted = try Data(contentsOf:base.appendingPathComponent("mystash-share/\(id).image"))
    XCTAssertNil(persisted.range(of:Data(canary.utf8)))
    try core.syncSession(["accountId":"fixture-images-b","expiresAt":0])
    XCTAssertTrue(try core.listImages("fixture-images-b").isEmpty())
    XCTAssertThrowsError(try core.imageBytes(id,owner))
    try core.syncSession(account)
    XCTAssertFalse(try core.imageBytes(id,owner).isEmpty)
    XCTAssertTrue(try core.listPending(owner).contains { $0["id"] as? String == urlID })
    try core.updateImage(id,owner,["state":"accepted","importId":UUID().uuidString.lowercased()])
    XCTAssertThrowsError(try core.imageBytes(id,owner))
    try core.removeImage(id,owner);try core.discard(urlID,owner)
  }
}
