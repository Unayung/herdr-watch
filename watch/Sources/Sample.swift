import Foundation

// Fixtures for the Xcode canvas. Nothing here touches the network, so the previews
// render without a bridge, a token, or a watch.

extension Agent {
    static func sample(_ title: String, _ folder: String, _ status: String, seq: Int, agent: String = "claude") -> Agent {
        Agent(
            paneId: "w1:p\(seq)",
            sessionId: "session-\(seq)",
            agent: agent,
            status: status,
            title: title,
            folder: folder,
            cwd: "/home/you/\(folder)",
            focused: false,
            seq: seq
        )
    }

    static let samples: [Agent] = [
        .sample("清掉已合併的本地分支", "pluto", "blocked", seq: 1),
        .sample("Firstline", "pluto", "done", seq: 2),
        .sample("規劃 Neptune 家族遷移至 GPT-5 和 Response API", "Neptune", "working", seq: 3),
        .sample("Debug and fix Steam application startup", "unayung", "idle", seq: 4),
    ]

    /// A machine running more than one kind, so the roster names them.
    static let mixedSamples: [Agent] = samples + [
        .sample("port the CSV importer", "billing", "working", seq: 5, agent: "codex"),
        .sample("chase down the flaky spec", "billing", "blocked", seq: 6, agent: "agy"),
    ]
}

extension HookEvent {
    static let sample = HookEvent(
        sessionId: "session-1",
        event: "PermissionRequest",
        tool: "AskUserQuestion",
        detail: "",
        questions: [
            Question(
                question: "要清掉 18 支已合併的分支嗎？",
                options: [
                    Option(label: "清掉", description: ""),
                    Option(label: "先留著", description: "之後再說"),
                ]
            )
        ]
    )
}

extension Bridge {
    @MainActor
    static var preview: Bridge {
        let bridge = Bridge()
        bridge.token = "preview"
        bridge.agents = Agent.samples
        bridge.questions = ["session-1": .sample]
        bridge.connected = true
        return bridge
    }

    @MainActor
    static var previewMixed: Bridge {
        let bridge = Bridge()
        bridge.token = "preview"
        bridge.agents = Agent.mixedSamples
        bridge.connected = true
        return bridge
    }

    @MainActor
    static var previewUnpaired: Bridge {
        let bridge = Bridge()
        bridge.token = ""
        return bridge
    }
}
