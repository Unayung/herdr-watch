import SwiftUI

/// The accent, taken from the app icon, and a grey ramp for text.
///
/// Status keeps a hue each — the state of a pane is worth reading directly. What
/// carries the urgency instead is weight and text brightness: the rows that want
/// you are heavier and brighter, so a raised wrist ranks them before you have read
/// a word, without giving up which state each one is in.
enum Palette {
    static let amber = Color(red: 252 / 255, green: 175 / 255, blue: 36 / 255)

    static let loud = Color.white.opacity(0.92)
    static let plain = Color.white.opacity(0.38)
    static let faint = Color.white.opacity(0.18)
}
