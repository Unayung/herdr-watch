import SwiftUI

/// Pairing, not token entry. Six digits is the most anyone should have to type on
/// a watch — run `npm run pair` on the machine to read the current code.
struct PairView: View {
    @EnvironmentObject var bridge: Bridge
    @State private var code = ""
    @State private var working = false

    var body: some View {
        // A List, for the same reason the detail view uses one: watchOS sizes its
        // rows full width, so the button lands centred without any frame tuning.
        List {
            Section("主機") {
                TextField("host", text: $bridge.host)
                    .font(.footnote)
            }

            Section("配對碼") {
                TextField("6 位數", text: $code)
                    .font(.title3)
                Button {
                    working = true
                    Task {
                        await bridge.pair(code: code)
                        code = ""
                        working = false
                    }
                } label: {
                    if working { ProgressView() } else { Text("配對") }
                }
                .disabled(code.count != 6 || working)
            }

            if let error = bridge.error {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        }
        .navigationTitle("herdr")
    }
}

#Preview("配對") {
    NavigationStack { PairView() }
        .environmentObject(Bridge.previewUnpaired)
}
