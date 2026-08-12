import SwiftUI
import WatchKit

struct AgentDetailView: View {
    let agent: Agent
    @EnvironmentObject var bridge: Bridge
    @State private var screen = ""
    @State private var loading = true

    /// The live row, so status keeps updating while you are reading the screen.
    private var current: Agent {
        bridge.agents.first { $0.paneId == agent.paneId } ?? agent
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Circle().fill(current.color).frame(width: 8, height: 8)
                    Text(current.label).font(.caption)
                    Spacer()
                }
                Text(current.folder)
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                // Buttons exist only while herdr still says this pane is blocked.
                // The moment it is answered anywhere — terminal, notch, or here —
                // the roster event flips the status and they go away by themselves.
                if current.status == "blocked" {
                    if let question = askedQuestion {
                        Text(question.question)
                            .font(.footnote)
                            .padding(.top, 4)
                        ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                            Button {
                                send(keys: ["\(index + 1)"])
                            } label: {
                                Text(option.label).font(.caption)
                            }
                        }
                    }
                    Button("取消 (Esc)", role: .destructive) { send(keys: ["esc"]) }
                        .font(.caption2)
                    Divider()
                }

                if loading {
                    ProgressView()
                } else {
                    Text(screen.isEmpty ? "（讀不到畫面）" : screen)
                        .font(.system(size: 12, design: .monospaced))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(current.title)
        .task { await load() }
    }

    /// The options the hook reported, but only for this pane's session.
    private var askedQuestion: HookEvent.Question? {
        guard let hook = bridge.lastHook,
              hook.sessionId != nil,
              hook.sessionId == current.sessionId
        else { return nil }
        return hook.questions?.first
    }

    private func send(keys: [String]) {
        let pane = current.paneId
        let seq = current.seq
        Task {
            let sent = await bridge.reply(pane: pane, seq: seq, keys: keys)
            WKInterfaceDevice.current().play(sent ? .success : .failure)
            await load()
        }
    }

    private func load() async {
        loading = true
        screen = await bridge.screen(pane: agent.paneId)
        loading = false
    }
}

#Preview("等你回覆") {
    NavigationStack { AgentDetailView(agent: Agent.samples[0]) }
        .environmentObject(Bridge.preview)
}

#Preview("進行中") {
    NavigationStack { AgentDetailView(agent: Agent.samples[2]) }
        .environmentObject(Bridge.preview)
}
