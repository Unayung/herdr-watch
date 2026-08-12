import SwiftUI

struct RosterView: View {
    @EnvironmentObject var bridge: Bridge

    var body: some View {
        List {
            if let error = bridge.error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
            ForEach(bridge.agents) { agent in
                NavigationLink(value: agent) {
                    AgentRow(agent: agent)
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

struct AgentRow: View {
    let agent: Agent

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
                Text("\(agent.folder) · \(agent.label)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
