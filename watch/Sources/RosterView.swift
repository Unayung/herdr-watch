import SwiftUI

struct RosterView: View {
    @EnvironmentObject var bridge: Bridge

    private var mixedAgents: Bool {
        Set(bridge.agents.map(\.agent)).count > 1
    }

    /// The count belongs in the title because it is the answer to the question that
    /// made you raise your arm. Absent when nothing wants you — a standing "0" is
    /// one more thing to read past.
    private var title: String {
        let waiting = bridge.agents.filter(\.wantsYou).count
        let name = bridge.connected ? "herdr-watch" : "herdr-watch ⚠︎"
        return waiting > 0 ? "\(name) · \(waiting)" : name
    }

    var body: some View {
        List {
            if let error = bridge.error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
            ForEach(bridge.agents) { agent in
                NavigationLink(value: agent) {
                    AgentRow(agent: agent, nameAgent: mixedAgents)
                }
            }
            if bridge.agents.isEmpty {
                Text("沒有 agent")
                    .foregroundStyle(Palette.plain)
            }
            Button("取消配對", role: .destructive) { bridge.unpair() }
                .font(.caption2)
        }
        .navigationTitle(title)
        .animation(.snappy, value: bridge.agents)
        .navigationDestination(for: Agent.self) { AgentDetailView(agent: $0) }
        .task {
            await bridge.refresh()
            bridge.connect()
        }
        .refreshable { await bridge.refresh() }
    }
}

#Preview("清單") {
    NavigationStack { RosterView() }
        .environmentObject(Bridge.preview)
}

#Preview("混合 agent") {
    NavigationStack { RosterView() }
        .environmentObject(Bridge.previewMixed)
}

struct AgentRow: View {
    let agent: Agent
    /// Named only when the roster holds more than one kind. On an all-Claude
    /// machine the word is on every row and tells you nothing; the moment you mix,
    /// it is the first thing you need.
    let nameAgent: Bool

    var body: some View {
        HStack(spacing: 9) {
            // A rule down the full height of the row, not a dot. A shape with no
            // intrinsic size stretches to the stack, so it grows with a two-line
            // title and stays the loudest thing in the row either way.
            Capsule()
                .fill(agent.color)
                .frame(width: 3)
            VStack(alignment: .leading, spacing: 2) {
                Text(agent.title)
                    .font(.system(.footnote, design: .rounded).weight(agent.emphasis))
                    .foregroundStyle(agent.wantsYou ? Palette.loud : Palette.plain)
                    .lineLimit(2)
                Text(nameAgent
                     ? "\(agent.agentName) · \(agent.folder) · \(agent.label)"
                     : "\(agent.folder) · \(agent.label)")
                    .font(.caption2)
                    .foregroundStyle(Palette.faint)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 3)
    }
}
