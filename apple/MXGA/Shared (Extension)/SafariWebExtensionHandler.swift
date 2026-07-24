import SafariServices

/// The Safari P0 build does not expose native messaging. The principal class
/// remains present because Safari Web Extension bundles require an extension
/// handler, but all product data stays in WebExtension local storage.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: ["supported": false]]
        context.completeRequest(returningItems: [response])
    }
}
