import SwiftUI

/// One row of the bridge's /roster. Field names match the JSON exactly, so no
/// CodingKeys are needed.
struct Agent: Codable, Identifiable, Hashable {
    let paneId: String
    let sessionId: String?
    let agent: String
    let status: String
    let title: String
    let folder: String
    let cwd: String
    let focused: Bool

    var id: String { paneId }

    /// herdr's vocabulary: blocked is waiting on you, done is finished and unseen.
    var color: Color {
        switch status {
        case "blocked": return .orange
        case "done": return .green
        case "working": return .blue
        default: return .secondary
        }
    }

    var label: String {
        switch status {
        case "blocked": return "等你回覆"
        case "done": return "完成"
        case "working": return "進行中"
        case "idle": return "閒置"
        default: return status
        }
    }

    var wantsYou: Bool { status == "blocked" || status == "done" }
}

struct RosterEnvelope: Codable {
    let roster: [Agent]
}

struct ScreenEnvelope: Codable {
    let pane: String
    let text: String
}

struct PairEnvelope: Codable {
    let token: String
}

/// A Claude Code hook the bridge forwarded. Only PermissionRequest carries
/// questions; everything else is a bare notice.
struct HookEvent: Codable, Identifiable {
    struct Option: Codable, Hashable {
        let label: String
        let description: String
    }

    struct Question: Codable, Hashable {
        let question: String
        let options: [Option]
    }

    let sessionId: String?
    let event: String
    let tool: String?
    let detail: String
    let questions: [Question]?

    var id: String { "\(sessionId ?? "-")-\(event)-\(detail)" }
}
