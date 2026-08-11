import SwiftUI

/// Pairing, not token entry. Six digits is the most anyone should have to type on
/// a watch — run `npm run pair` on the machine to read the current code.
struct PairView: View {
    @EnvironmentObject var bridge: Bridge
    @State private var code = ""
    @State private var working = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("主機")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                TextField("host", text: $bridge.host)
                    .font(.footnote)

                Text("配對碼")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                TextField("6 位數", text: $code)
                    .font(.title3)

                if let error = bridge.error {
                    Text(error)
                        .font(.caption2)
                        .foregroundStyle(.red)
                }

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
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("herdr")
    }
}
