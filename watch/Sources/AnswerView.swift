import SwiftUI
import WatchKit

/// The decision, on a page of its own. Reaching it takes a deliberate tap, so
/// scrolling through what an agent has been doing cannot approve anything.
struct AnswerView: View {
    let agent: Agent
    @EnvironmentObject var bridge: Bridge
    @Environment(\.dismiss) private var dismiss

    private var current: Agent {
        bridge.agents.first { $0.paneId == agent.paneId } ?? agent
    }

    /// The options the hook reported, but only for this pane's session.
    private var askedQuestion: HookEvent.Question? {
        guard let hook = bridge.lastHook,
              hook.sessionId != nil,
              hook.sessionId == current.sessionId
        else { return nil }
        return hook.questions?.first
    }

    var body: some View {
        List {
            if let question = askedQuestion {
                Text(question.question)
                    .font(.footnote)
                    .listRowBackground(Color.clear)
                ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                    Button(option.label) { send(keys: ["\(index + 1)"]) }
                        .font(.system(.caption, design: .rounded).weight(.semibold))
                        .tint(Palette.amber)
                }
            } else {
                // The hook fires once. Open the app afterwards and the options are
                // gone, but the pane is still waiting — Esc still gets you out.
                Text("沒收到選項，畫面內容在上一頁")
                    .font(.caption2)
                    .foregroundStyle(Palette.plain)
                    .listRowBackground(Color.clear)
            }
            Button("取消 (Esc)", role: .destructive) { send(keys: ["esc"]) }
                .font(.caption2)
        }
        .navigationTitle("回覆")
        // Answered in the terminal or another app while you were reading it: there
        // is nothing left to press, so stop offering.
        .onChange(of: current.status) { _, status in
            if status != "blocked" { dismiss() }
        }
    }

    private func send(keys: [String]) {
        let pane = current.paneId
        let seq = current.seq
        Task {
            let sent = await bridge.reply(pane: pane, seq: seq, keys: keys)
            WKInterfaceDevice.current().play(sent ? .success : .failure)
            dismiss()
        }
    }
}

#Preview("回覆") {
    NavigationStack { AnswerView(agent: Agent.samples[0]) }
        .environmentObject(Bridge.preview)
}
