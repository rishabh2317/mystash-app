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
}
