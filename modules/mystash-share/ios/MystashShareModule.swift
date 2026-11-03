import ExpoModulesCore
import UIKit

public class MystashShareModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MystashShare")
    AsyncFunction("captureCapabilities") { ["version": 1, "urls": true, "images": true] as [String: Any] }
    AsyncFunction("enqueueUrl") { (url: String, owner: String) in try ShareCore.shared.enqueueUrl(url,owner) }
    AsyncFunction("enqueueImage") { (uri: String, origin: String, owner: String) in try ShareCore.shared.enqueueImage(uri,origin,owner) }
    AsyncFunction("listImages") { (owner: String) in try ShareCore.shared.listImages(owner) }
    AsyncFunction("imageBytes") { (id: String, owner: String) in try ShareCore.shared.imageBytes(id,owner) }
    AsyncFunction("updateImage") { (id: String, owner: String, patch: [String: Any]) in try ShareCore.shared.updateImage(id,owner,patch) }
    AsyncFunction("removeImage") { (id: String, owner: String) in try ShareCore.shared.removeImage(id,owner) }
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
