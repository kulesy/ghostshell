import GhostShellKit
import SwiftUI

public struct SignInScreen: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var password = ""
    @State private var failure: GhostShellError?
    @State private var working = false
    @State private var passkeyOffered = false
    @State private var passkeyWorking = false
    @FocusState private var focus: Field?

    private enum Field { case address, password }

    #if os(iOS)
    private static let addressPrompt = "https://your-mac.your-tailnet.ts.net"
    #else
    private static let addressPrompt = "http://localhost:4310"
    #endif

    public init() {}

    // Where an error shows follows what the person can change: a bad or unreachable address sits under the address, a refused password under the password.
    private var addressProblem: String? {
        switch failure { case .badAddress?, .unreachable?: failure?.errorDescription; default: nil }
    }
    private var passwordProblem: String? {
        switch failure { case .wrongPassword?, .locked?, .server?, .refused?: failure?.errorDescription; default: nil }
    }

    public var body: some View {
        GeometryReader { screen in
            ScrollViewReader { scroll in
                ScrollView {
                    card
                        .frame(maxWidth: 384)
                        .padding(24)
                        .frame(maxWidth: .infinity, minHeight: screen.size.height)
                        .id(Self.top)
                }
                .scrollBounceBehavior(.basedOnSize)
                // The keyboard scrolls the card up to show the field. When it goes away or a problem appears, the card returns to the top, below the status bar.
                .onChange(of: focus) { if focus == nil { scroll.scrollTo(Self.top, anchor: .top) } }
                .onChange(of: failure == nil) { scroll.scrollTo(Self.top, anchor: .top) }
            }
        }
        .background(Self.ground.ignoresSafeArea())
        .onAppear {
            address = model.addressText
            focus = address.isEmpty ? .address : .password
        }
        // Waits for the typing to settle before asking the typed address whether it has a passkey.
        .task(id: address) {
            passkeyOffered = false
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            let offered = await model.offersPasskey(address: address)
            if !Task.isCancelled { passkeyOffered = offered }
        }
    }

    private var card: some View {
        VStack(spacing: 24) {
            VStack(spacing: 6) {
                ShellMark().frame(width: 42, height: 42).foregroundStyle(Color.ghost.foreground).padding(.bottom, 6)
                // The page draws the name as a Geist Mono wordmark graphic on two lines.
                VStack(spacing: -6) {
                    Text("GHOST")
                    Text("SHELL")
                }
                .font(.geistMono(Self.wordmarkSize, weight: Self.wordmarkWeight, relativeTo: .title))
                .tracking(Self.wordmarkSize > 24 ? 4 : 3)
                .foregroundStyle(Color.ghost.foreground)
                .padding(.bottom, 6)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("GhostShell")
                .accessibilityAddTraits(.isHeader)
                Text("Sign in to talk to your sessions on this Mac.")
                    .font(.geist(14, relativeTo: .subheadline))
                    .foregroundStyle(Color.ghost.mutedForeground)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 16) {
                field("Address", problem: addressProblem, focused: focus == .address) {
                    TextField("Address", text: $address, prompt: Text(Self.addressPrompt).foregroundStyle(Color.ghost.mutedForeground))
                        .focused($focus, equals: .address)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        #if os(iOS)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                }
                field("Password", problem: passwordProblem, focused: focus == .password) {
                    #if os(macOS)
                    SecureField(text: $password, prompt: Text("")) { Text("Password") }
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(signIn)
                    #else
                    SecureField("Password", text: $password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(signIn)
                    #endif
                }
                #if os(iOS)
                if passkeyOffered {
                    Button(action: signInWithPasskey) {
                        Text(passkeyWorking ? "Signing in" : "Sign in with a passkey")
                    }
                    .buttonStyle(.ghost(.outline, radius: Self.fieldRadius, fills: true))
                    .disabled(working || passkeyWorking)
                }
                #endif
            }
            Button(action: signIn) {
                HStack(spacing: 8) {
                    if working { ProgressView().controlSize(.small) }
                    Text(working ? "Signing in" : "Sign in")
                }
            }
            .buttonStyle(.ghost(.primary, radius: Self.fieldRadius, fills: true))
            .keyboardShortcut(.defaultAction)
            .disabled(working || passkeyWorking || (Self.needsPassword && password.isEmpty))
        }
        .textFieldStyle(.plain)
        .padding(24)
        .background(Self.cardFill, in: GhostShape(Self.cardRadius))
        .overlay(GhostShape(Self.cardRadius).strokeBorder(Self.line, lineWidth: 1))
        .shadow(color: .black.opacity(0.06), radius: 2, y: 1)
    }

    // NOTE: [11 Nov 2026] EK - The sign-in page loads only app.css, so it keeps shadcn's own radii (14 card, 8 field) and not the 2 to 4 of GhostRadius.
    // On the Mac the page draws both bevelled, 11 on the card and 5 on a field, in app.css's own palette, which GhostPalette does not hold.
    #if os(macOS)
    private static let cardRadius = GhostRadius.xl
    private static let fieldRadius = GhostRadius.sm
    private static let fieldHeight: CGFloat = 36
    private static let fieldSize: CGFloat = 14
    private static let wordmarkSize: CGFloat = 22
    private static let wordmarkWeight = Font.Weight.regular
    private static let needsPassword = false
    private static let ringRadius = GhostRadius.sm
    private static let ground = Color(light: .init(0.97), dark: .init(0.269))
    private static let cardFill = Color(light: .init(1), dark: .init(0.205))
    private static let line = Color(light: .init(0.922), dark: .init(1, alpha: 0.10))
    private static let inputLine = Color(light: .init(0.922), dark: .init(1, alpha: 0.15))
    #else
    private static let cardRadius: CGFloat = 14
    private static let fieldRadius: CGFloat = 8
    private static let fieldHeight: CGFloat = 44
    private static let fieldSize: CGFloat = 16
    private static let wordmarkSize: CGFloat = 26
    private static let wordmarkWeight = Font.Weight.medium
    private static let needsPassword = true
    private static let ringRadius: CGFloat = 9.5
    private static let ground = Color.ghost.muted
    private static let cardFill = Color.ghost.card
    private static let line = Color.ghost.border
    private static let inputLine = Color.ghost.input
    #endif
    private static let top = "top"

    private func field<Input: View>(_ label: String, problem: String?, focused: Bool, @ViewBuilder input: () -> Input) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.geist(14, weight: .medium, relativeTo: .subheadline)).foregroundStyle(Color.ghost.foreground)
            input()
                .font(.geist(Self.fieldSize))
                .foregroundStyle(Color.ghost.cardForeground)
                .padding(.horizontal, 12)
                .frame(minHeight: Self.fieldHeight)
                .background(Self.cardFill, in: GhostShape(Self.fieldRadius))
                .overlay(GhostShape(Self.fieldRadius)
                    .strokeBorder(problem != nil ? Color.ghost.destructive : focused ? Color.ghost.ring : Self.inputLine, lineWidth: 1))
                .overlay {
                    if problem != nil || focused {
                        GhostShape(Self.ringRadius)
                            .strokeBorder((problem != nil ? Color.ghost.destructive : Color.ghost.ring).opacity(problem != nil ? 0.2 : 0.5), lineWidth: 3)
                            .padding(-3)
                            .allowsHitTesting(false)
                    }
                }
                .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
            if let problem {
                Text(problem)
                    .font(.geist(14, relativeTo: .subheadline))
                    .foregroundStyle(Color.ghost.destructive)
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

    private func signInWithPasskey() {
        guard !working, !passkeyWorking else { return }
        passkeyWorking = true
        failure = nil
        focus = nil
        Task {
            do {
                try await model.signInWithPasskey(address: address)
            } catch is CancellationError {
                // Backing out of the system sheet is a choice, so nothing shows.
            } catch {
                failure = error as? GhostShellError ?? .unreachable
            }
            passkeyWorking = false
        }
    }
}
