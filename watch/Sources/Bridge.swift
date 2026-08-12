import Foundation
import SwiftUI

/// Talks to the herdr-watch bridge over its Funnel URL.
///
/// The watch cannot join a tailnet, so this connects to the public Funnel
/// hostname and proves itself with the bearer token it got from pairing.
@MainActor
final class Bridge: ObservableObject {
    @Published var agents: [Agent] = []
    @Published var lastHook: HookEvent?
    @Published var connected = false
    @Published var error: String?

    // Plain UserDefaults rather than @AppStorage: that wrapper is a View
    // DynamicProperty and does not drive objectWillChange from here.
    @Published var host: String {
        didSet { UserDefaults.standard.set(host, forKey: "host") }
    }

    @Published var token: String {
        didSet { UserDefaults.standard.set(token, forKey: "token") }
    }

    private var stream: Task<Void, Never>?

    init() {
        let defaults = UserDefaults.standard
        host = defaults.string(forKey: "host") ?? "herdr.ccy.works"
        token = defaults.string(forKey: "token") ?? ""
    }

    var paired: Bool { !token.isEmpty }

    private func url(_ path: String, query: String = "") -> URL? {
        URL(string: "https://\(host)\(path)\(query)")
    }

    private func request(_ path: String, query: String = "") -> URLRequest? {
        guard let url = url(path, query: query) else { return nil }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return req
    }

    /// Swap a 6-digit code for the real token. Typing the token on a watch is not
    /// a thing anyone should have to do.
    func pair(code: String) async {
        error = nil
        guard let url = url("/pair") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["code": code])
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                error = "配對碼不對或已過期"
                return
            }
            token = try JSONDecoder().decode(PairEnvelope.self, from: data).token
            connect()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func unpair() {
        stream?.cancel()
        stream = nil
        token = ""
        agents = []
        connected = false
    }

    /// One-shot fetch, used on appear so the list is never empty while the stream
    /// is still opening.
    func refresh() async {
        guard let req = request("/roster") else { return }
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            agents = try JSONDecoder().decode(RosterEnvelope.self, from: data).roster
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Answer a prompt by typing into the pane. This deliberately does not go
    /// through the hook: the terminal, the notch, and the wrist are all just input
    /// to the same TTY, and whoever gets there first wins. A 409 means someone
    /// already did — the roster will drop the buttons on its own.
    @discardableResult
    func reply(pane: String, seq: Int, keys: [String]) async -> Bool {
        guard let url = url("/reply") else { return false }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["pane": pane, "seq": seq, "keys": keys])
        do {
            let (_, response) = try await URLSession.shared.data(for: req)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if code == 409 { error = "已經在別處回答過了" }
            await refresh()
            return code == 200
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func screen(pane: String) async -> String {
        let escaped = pane.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? pane
        guard let req = request("/screen", query: "?pane=\(escaped)") else { return "" }
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            return try JSONDecoder().decode(ScreenEnvelope.self, from: data).text
        } catch {
            return ""
        }
    }

    /// Long-lived SSE, alive only while the app is in front — watchOS will not keep
    /// a socket open in the background. Missing that window is what the Bark push
    /// on the phone is for.
    func connect() {
        guard paired, stream == nil else { return }
        stream = Task { [weak self] in
            var backoff: UInt64 = 1
            while !Task.isCancelled {
                await self?.readStream()
                await MainActor.run { self?.connected = false }
                try? await Task.sleep(nanoseconds: backoff * 1_000_000_000)
                backoff = min(backoff * 2, 30)
            }
        }
    }

    func disconnect() {
        stream?.cancel()
        stream = nil
        connected = false
    }

    private func readStream() async {
        guard let req = request("/events") else { return }
        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: req)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                error = "連線被拒（token 可能失效）"
                return
            }
            connected = true
            error = nil
            var event = ""
            for try await line in bytes.lines {
                if line.hasPrefix("event: ") {
                    event = String(line.dropFirst(7))
                } else if line.hasPrefix("data: ") {
                    apply(event: event, json: String(line.dropFirst(6)))
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func apply(event: String, json: String) {
        guard let data = json.data(using: .utf8) else { return }
        switch event {
        case "roster":
            if let envelope = try? JSONDecoder().decode(RosterEnvelope.self, from: data) {
                agents = envelope.roster
            }
        case "hook":
            if let hook = try? JSONDecoder().decode(HookEvent.self, from: data) {
                lastHook = hook
            }
        default:
            break
        }
    }
}

extension CharacterSet {
    /// `:` is legal in a query but shows up in every herdr pane id, so keep it
    /// escaped rather than trusting each client to cope.
    static let urlQueryValueAllowed = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: ":&=?+"))
}
