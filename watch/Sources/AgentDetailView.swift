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
                // The task title carries the whole line here rather than in the
                // navigation bar, where watchOS truncates it after a few words.
                Text(current.title)
                    .font(.footnote)
                HStack(spacing: 6) {
                    Circle().fill(current.color).frame(width: 8, height: 8)
                    Text(current.label)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Spacer()
                }

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
                                // The surrounding stack is leading-aligned so the
                                // text reads properly; buttons have to be told to
                                // span the width or they stop at their content.
                                Text(option.label)
                                    .font(.caption)
                                    .frame(maxWidth: .infinity)
                            }
                        }
                    }
                    Button(role: .destructive) {
                        send(keys: ["esc"])
                    } label: {
                        Text("取消 (Esc)")
                            .font(.caption2)
                            .frame(maxWidth: .infinity)
                    }
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
        .navigationTitle(current.folder)
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
