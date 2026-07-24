import SwiftUI

@main
struct MXGAApp: App {
    var body: some Scene {
        Window("Make X Great Again", id: "onboarding") {
            OnboardingView()
        }
        .defaultSize(width: 640, height: 560)
        .windowResizability(.contentSize)
    }
}
