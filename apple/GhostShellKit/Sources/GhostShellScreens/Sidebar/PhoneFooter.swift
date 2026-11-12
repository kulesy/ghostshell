#if os(iOS)
import GhostShellKit
import SwiftUI

/// Under the phone's list, as the page draws it: the unreachable line, the select bar while choosing, then Routines and Scheduled with the account menu.
struct PhoneFooter: View {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state
    @Environment(OrganiseModel.self) private var organise

    var body: some View {
        VStack(spacing: 0) {
            if model.connection == .unreachable { UnreachableLine() }
            if state.editing { PhoneSelectBar() }
            // The footer rides up on the keyboard, so it steps aside while a row is being named or it covers that row.
            if organise.naming?.inline != true {
                Rectangle().fill(Color.ghost.sidebarBorder).frame(height: 1)
                HStack(spacing: 0) {
                    footLink("Routines") { model.navigator.show { RoutinesScreen() } }
                    if model.routines.features.scheduled {
                        footLink("Scheduled") { model.navigator.show { ScheduledScreen() } }
                    }
                    Spacer(minLength: 0)
                    AccountMenu()
                }
                .padding(.horizontal, 4)
            }
        }
        .background(Color.ghost.sidebar)
    }

    private func footLink(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.geist(14, weight: .medium, relativeTo: .body))
                .foregroundStyle(Color.ghost.sidebarMuted)
                .padding(.horizontal, 10)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(title)
    }
}

/// The circle-user button: Accounts, Passkeys, the notification switch and Sign out, which the toolbar's More menu held before.
private struct AccountMenu: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Menu {
            Button("Accounts", systemImage: "person.2") { model.navigator.show { AccountsScreen() } }
            Button("Passkeys", systemImage: "key") { model.navigator.show { PasskeysScreen() } }
            NotificationToggle()
            Divider()
            Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right") { Task { await model.signOut() } }
        } label: {
            Image(systemName: "person.crop.circle").font(.system(size: 19)).foregroundStyle(Color.ghost.sidebarMuted).phoneIconTouch()
        }
        .menuStyle(.borderlessButton)
        // A menu opening upward from the footer is reversed by default, which would put Sign out on top.
        .menuOrder(.fixed)
        .accessibilityLabel("Account")
    }
}

/// The page's pick bar: how many are chosen, Archive, the actions the Mac's selection menu holds, and a close button that leaves edit mode.
struct PhoneSelectBar: View {
    @Environment(SidebarState.self) private var state
    @Environment(OrganiseModel.self) private var organise

    var body: some View {
        let ids = organise.ordered(state.selection)
        Rectangle().fill(Color.ghost.sidebarBorder).frame(height: 1)
        HStack(spacing: 0) {
            Text("\(state.selection.count) selected").font(.geist(13, relativeTo: .footnote)).monospacedDigit().foregroundStyle(Color.ghost.sidebarForeground).padding(.leading, 10)
            Spacer(minLength: 4)
            Button { organise.archiveMany(ids) } label: {
                Label("Archive", systemImage: "archivebox").font(.geist(13, relativeTo: .footnote)).foregroundStyle(Color.ghost.sidebarForeground).padding(.horizontal, 10).frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .disabled(ids.isEmpty)
            Menu { SelectionMenu(ids: ids) } label: {
                Text("Actions").font(.geist(13, relativeTo: .footnote)).foregroundStyle(Color.ghost.sidebarForeground).padding(.horizontal, 10).phoneIconTouch()
            }
            .menuStyle(.borderlessButton)
            .disabled(ids.isEmpty)
            Button { organise.clearSelection() } label: {
                Image(systemName: "xmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.ghost.sidebarMuted).phoneIconTouch()
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Done")
        }
        .padding(.horizontal, 4)
    }
}
#endif
