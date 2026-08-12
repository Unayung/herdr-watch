import SwiftUI

/// One accent, taken from the app icon, and a brightness ramp for everything else.
///
/// Four hues for four statuses spread the emphasis evenly and left nothing looking
/// urgent. Here amber is spent only on the one state that needs you to move, and
/// the rest fade by how safely they can be ignored — so a raised wrist answers
/// "does anything want me" before you have read a single word.
enum Palette {
    static let amber = Color(red: 252 / 255, green: 175 / 255, blue: 36 / 255)

    static let loud = Color.white.opacity(0.92)
    static let plain = Color.white.opacity(0.38)
    static let faint = Color.white.opacity(0.18)
}
