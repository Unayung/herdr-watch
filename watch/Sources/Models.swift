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
    /// herdr's state counter. Sent back with a reply so a tap that lost the race
    /// is refused instead of typing into whatever prompt came next.
    let seq: Int

    var id: String { paneId }

    /// herdr's vocabulary: blocked is waiting on you, done is finished and unseen.
    /// A hue each, because which state a pane is in is worth reading directly and
    /// not inferring from how bright it is. Blocked takes the app's amber so the
    /// one that needs you matches the icon.
    var color: Color {
        switch status {
        case "blocked": return Palette.amber
        case "done": return .green
        case "working": return .blue
        default: return Palette.faint
        }
    }

    /// Blocked and done both want you, but only one of them wants you now.
    var emphasis: Font.Weight {
        switch status {
        case "blocked": return .semibold
        case "done": return .medium
        default: return .regular
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

    /// herdr names an agent by a short id of its own. Spell out the ones a person
    /// would recognise and capitalise the rest, rather than carrying a table that
    /// has to be right about every agent herdr will ever learn.
    var agentName: String {
        switch agent {
        case "agy": return "Antigravity"
        case "claude": return "Claude"
        case "cline": return "Cline"
        case "codex": return "Codex"
        case "copilot": return "Copilot"
        case "cursor": return "Cursor"
        case "devin": return "Devin"
        case "gemini": return "Gemini"
        case "grok": return "Grok"
        case "opencode": return "OpenCode"
        case "qodercli": return "Qoder"
        default: return agent.capitalized
        }
    }
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
