import GhostShellKit
import SwiftUI

/// The list itself. One chosen row opens its session, and several stay chosen for bulk actions.
struct SidebarList: View {
    @Environment(AppModel.self) private var model
    @Environment(SidebarState.self) private var state
    @Environment(OrganiseModel.self) private var organise
    @State private var archived: [SessionRow] = []

    private var searching: Bool { !state.query.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        @Bindable var state = state
        let index = model.index ?? SessionIndex()
        let hits = searching ? SidebarOutline.search(state.query, in: index, archived: archived) : SearchHits()
        let sections = searching ? [] : SidebarOutline.sections(index, view: state.project, idleRoutines: state.idleRoutines)
        let noGroups = SidebarOutline.hasNoGroups(index, view: state.project)
        Group {
            if !model.hasLoaded {
                List {
                    ForEach(0..<8, id: \.self) { _ in SessionRowView(title: "Session title goes here", dot: nil).redacted(reason: .placeholder) }
                }
                .allowsHitTesting(false)
                .accessibilityLabel("Loading sessions")
            } else {
                // One list serves both the sections and the hits, so typing in the search field never swaps the list under it and drops its focus.
                List(selection: $state.selection) {
                    #if os(iOS)
                    PhoneNewGroupRow()
                    #endif
                    if searching {
                        SearchSections(hits: hits)
                    } else {
                        if SidebarOutline.view(state.project, in: index) == nil { HomeTopSectionsSlot() }
                        SidebarSections(sections: sections)
                        if noGroups, !sections.isEmpty { noGroupsNotice }
                    }
                }
                #if os(iOS)
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .environment(\.defaultMinListRowHeight, 0)
                #endif
                .overlay {
                    // A new group's field sits in the list, so the empty notice keeps out of its way.
                    if organise.naming?.target == .newGroup {
                        EmptyView()
                    } else if searching, hits.sessions.isEmpty, hits.subSessions.isEmpty, hits.archived.isEmpty {
                        #if os(iOS)
                        EmptyNotice(noGroups: false, searching: true)
                        #else
                        ContentUnavailableView.search(text: state.query)
                        #endif
                    } else if !searching, sections.isEmpty {
                        EmptyNotice(noGroups: noGroups)
                    }
                }
            }
        }
        // The archive is read when the search opens and not again while it stays open, as on the page.
        .task(id: searching) { if searching { archived = (try? await model.client?.archivedSessions()) ?? [] } }
        .onChange(of: state.selection) { _, chosen in
            if !state.editing, chosen.count == 1, let id = chosen.first, id != model.navigator.selectedSessionID { model.navigator.openSession(id) }
        }
        .onChange(of: model.navigator.selectedSessionID) { _, id in
            if let id, !state.selection.contains(id) { state.selection = [id] } else if id == nil { state.selection = [] }
            if let id { reveal(id) }
        }
    }

    @ViewBuilder private var noGroupsNotice: some View {
        #if os(iOS)
        Text("No groups yet. Tap + to make one.").font(.geist(12, relativeTo: .caption)).foregroundStyle(Color.ghost.sidebarMuted).padding(.leading, 6).phoneListRow()
        #else
        EmptyNotice(noGroups: true)
        #endif
    }

    // Opening a session shows where it lives: its project's view, and its family unfolded. This happens once per open, not on later refreshes.
    private func reveal(_ id: String) {
        guard let index = model.index else { return }
        if case .view(let project) = SidebarOutline.holder(of: id, in: index), project != SidebarOutline.view(state.project, in: index) { state.project = project }
        if let parent = model.rows.first(where: { $0.id == id })?.parent, !state.isUnfolded(parent) { state.setUnfolded(parent, true) }
    }
}
