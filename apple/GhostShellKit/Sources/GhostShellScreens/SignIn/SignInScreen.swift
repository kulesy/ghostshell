import GhostShellKit
import SwiftUI

public struct SignInScreen: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var password = ""
    @State private var failure: GhostShellError?
    @State private var working = false
    @FocusState private var focus: Field?

    private enum Field { case address, password }

    public init() {}

    // Where an error shows follows what the person can change: a bad or unreachable address sits under the address, a refused password under the password.
    private var addressProblem: String? {
        switch failure { case .badAddress?, .unreachable?: failure?.errorDescription; default: nil }
    }
    private var passwordProblem: String? {
        switch failure { case .wrongPassword?, .locked?, .server?: failure?.errorDescription; default: nil }
    }

    public var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 10) {
                ShellMark().frame(width: 56, height: 56)
                Text("GhostShell").font(.title2.weight(.semibold))
            }
            VStack(alignment: .leading, spacing: 16) {
                field("Address", problem: addressProblem) {
                    TextField("Address", text: $address, prompt: Text("http://localhost:4310"))
                        .focused($focus, equals: .address)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        #if os(iOS)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                }
                field("Password", problem: passwordProblem) {
                    SecureField("Password", text: $password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(signIn)
                }
            }
            Button(action: signIn) {
                HStack(spacing: 8) {
                    if working { ProgressView().controlSize(.small) }
                    Text(working ? "Signing in" : "Sign In")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
            .disabled(working || password.isEmpty)
        }
        .textFieldStyle(.roundedBorder)
        .frame(maxWidth: 320)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            address = model.addressText
            focus = address.isEmpty ? .address : .password
        }
    }

    private func field<Input: View>(_ label: String, problem: String?, @ViewBuilder input: () -> Input) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline).foregroundStyle(.secondary)
            input()
            if let problem {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                    Text(problem).foregroundStyle(.primary)
                }
                .font(.footnote)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel("\(label) problem. \(problem)")
            }
        }
    }

    private func signIn() {
        guard !working, !password.isEmpty else { return }
        working = true
        failure = nil
        Task {
            do {
                try await model.signIn(address: address, password: password)
                password = ""
            } catch {
                failure = error as? GhostShellError ?? .unreachable
                if addressProblem == nil { password = "" }
                focus = addressProblem == nil ? .password : .address
            }
            working = false
        }
    }
}
