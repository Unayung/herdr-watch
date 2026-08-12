import SwiftUI
import WatchKit

/// Dictate the next instruction to an agent.
///
/// There is no Speech framework here on purpose: tapping a watchOS TextField
/// already offers dictation alongside scribble and emoji, and the OS handles the
/// microphone permission. A recogniser of our own would be more code for a worse
/// keyboard.
struct SpeakView: View {
    let agent: Agent
    @EnvironmentObject var bridge: Bridge
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false

    private var current: Agent {
        bridge.agents.first { $0.paneId == agent.paneId } ?? agent
    }

    var body: some View {
        List {
            Section {
                TextField("說點什麼", text: $text)
                    .font(.footnote)
                Button {
                    sending = true
                    Task {
                        let sent = await bridge.prompt(pane: current.paneId, text: text)
                        WKInterfaceDevice.current().play(sent ? .success : .failure)
                        sending = false
                        if sent { dismiss() }
                    }
                } label: {
                    if sending { ProgressView() } else { Text("送出") }
                }
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || sending)
                .font(.caption)
            }

            if let error = bridge.error {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .listRowBackground(Color.clear)
            }
        }
        .navigationTitle("說給 \(current.folder)")
    }
}

#Preview("說話") {
    NavigationStack { SpeakView(agent: Agent.samples[3]) }
        .environmentObject(Bridge.preview)
}
