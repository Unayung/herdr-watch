import SwiftUI

@main
struct HerdrWatchApp: App {
    @StateObject private var bridge = Bridge()

    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(bridge)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var bridge: Bridge
    @Environment(\.scenePhase) private var phase

    var body: some View {
        NavigationStack {
            if bridge.paired {
                RosterView()
            } else {
                PairView()
            }
        }
        .onChange(of: phase) { _, new in
            // watchOS will not hold the stream in the background, so stop asking it
            // to. Bark on the phone covers the time the app is not in front.
            switch new {
            case .active: bridge.connect()
            case .background: bridge.disconnect()
            default: break
            }
        }
    }
}
