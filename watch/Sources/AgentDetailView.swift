import SwiftUI

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

                if let hook = bridge.lastHook,
                   hook.sessionId == current.sessionId,
                   let questions = hook.questions {
                    ForEach(questions, id: \.self) { question in
                        Text(question.question)
                            .font(.footnote)
                            .padding(.top, 4)
                        ForEach(question.options, id: \.self) { option in
                            Text("• \(option.label)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
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
        .navigationTitle(current.title)
        .task { await load() }
    }

    private func load() async {
        loading = true
        screen = await bridge.screen(pane: agent.paneId)
        loading = false
    }
}
