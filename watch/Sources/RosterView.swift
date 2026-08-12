import SwiftUI

struct RosterView: View {
    @EnvironmentObject var bridge: Bridge

    private var mixedAgents: Bool {
        Set(bridge.agents.map(\.agent)).count > 1
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
                    .foregroundStyle(.secondary)
            }
            Button("取消配對", role: .destructive) { bridge.unpair() }
                .font(.caption2)
        }
        .navigationTitle(bridge.connected ? "herdr-watch" : "herdr-watch ⚠︎")
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
        HStack(alignment: .top, spacing: 6) {
            Circle()
                .fill(agent.color)
                .frame(width: 8, height: 8)
                .padding(.top, 4)
            VStack(alignment: .leading, spacing: 1) {
                Text(agent.title)
                    .font(.footnote)
                    .lineLimit(2)
                Text(nameAgent
                     ? "\(agent.agentName) · \(agent.folder) · \(agent.label)"
                     : "\(agent.folder) · \(agent.label)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
