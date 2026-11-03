import ExpoModulesCore
import UIKit

public class MystashShareModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MystashShare")
    AsyncFunction("syncSession") { (value: [String: Any]?) in try ShareCore.shared.syncSession(value) }
    AsyncFunction("listPending") { (owner: String?) -> [[String: Any]] in try ShareCore.shared.listPending(owner) }
    AsyncFunction("claim") { (id: String, owner: String) in try ShareCore.shared.claim(id,owner) }
    AsyncFunction("discard") { (id: String, owner: String?) in try ShareCore.shared.discard(id,owner) }
    AsyncFunction("retry") { (owner: String) in try ShareCore.shared.retryPending(owner) }
  }
}
public class MystashShareAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void) {
    guard identifier.hasPrefix("mystash.share.") else { return }
    ShareCore.shared.restore(identifier, completion: completionHandler)
  }
}
