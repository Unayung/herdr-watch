import SwiftUI
import WatchKit

/// Answering a numbered prompt with words instead of a number.
///
/// The free-text choice is not in the hook, so the bridge reads its number off the
/// screen, presses it, and types only once the screen has visibly changed. If the
/// prompt has no such choice this says so rather than pressing something else.
struct AnswerTextView: View {
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
                        let sent = await bridge.answerText(pane: current.paneId, seq: current.seq, text: text)
                        WKInterfaceDevice.current().play(sent ? .success : .failure)
                        sending = false
                        if sent { dismiss() }
                    }
                } label: {
                    if sending { ProgressView() } else { Text("送出") }
                }
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || sending)
                .font(.system(.caption, design: .rounded).weight(.semibold))
                .tint(Palette.amber)
            }

            if let error = bridge.error {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .listRowBackground(Color.clear)
            }
        }
        .navigationTitle("打字回覆")
    }
}

#Preview("打字回覆") {
    NavigationStack { AnswerTextView(agent: Agent.samples[0]) }
        .environmentObject(Bridge.preview)
}
