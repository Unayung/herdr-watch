import SwiftUI

/// What this agent has been doing. The decision, if there is one, lives one page
/// further in so that reading cannot become answering.
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
        // A List rather than a ScrollView: watchOS lays its rows out full width on
        // its own, which hand-tuned frames inside a leading-aligned stack did not.
        List {
            Section {
                // Status and task name on one row. Two rows of header pushed
                // everything else off the first screen, and neither line needed a
                // row of its own. Plain text clears the capsule every List row
                // carries on watchOS, so it does not read as something to press.
                HStack(spacing: 9) {
                    Capsule()
                        .fill(current.color)
                        .frame(width: 3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(current.title)
                            .font(.system(.footnote, design: .rounded).weight(current.emphasis))
                            .foregroundStyle(Palette.loud)
                        // Named unconditionally here: there is room, and knowing
                        // which agent you are answering changes what a button means.
                        Text("\(current.agentName) · \(current.label)")
                            .font(.caption2)
                            .foregroundStyle(Palette.faint)
                    }
                }
                .listRowBackground(Color.clear)

                // Blocked wants one of a numbered set; idle wants a sentence. They
                // are different inputs, so they get different entry points and
                // never both show at once.
                if current.status == "blocked" {
                    NavigationLink("回覆…") {
                        AnswerView(agent: current)
                    }
                    .font(.system(.caption, design: .rounded).weight(.semibold))
                    .tint(Palette.amber)
                } else if current.status == "idle" || current.status == "done" {
                    NavigationLink("說話…") {
                        SpeakView(agent: current)
                    }
                    .font(.caption)
                }
            }

            Section {
                if loading {
                    ProgressView()
                        .listRowBackground(Color.clear)
                } else {
                    // A text style rather than a fixed size: this is the part you
                    // actually read on a wrist, and it should follow the watch's
                    // own text size setting instead of ignoring it. Line spacing
                    // because the bridge hands over dense terminal prose, and a
                    // wall of it at this width is a wall.
                    Text(screen.isEmpty ? "（讀不到畫面）" : screen)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(Palette.loud)
                        .lineSpacing(3)
                        .listRowBackground(Color.clear)
                }
            }
        }
        .navigationTitle(current.folder)
        .task { await load() }
        .refreshable { await load() }
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
