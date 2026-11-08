import Foundation

// These rules follow the page (public/ui/tree.js, many-rules.js, pick.js, close.js, group-rules.js), and the server holds the same ones for `api/layout/*`.
// Where the page's words are shown to a person they are copied exactly.

/// One place a session can be moved to. `section` is `pinned`, `routines`, a loose list (`started`, `ungrouped`, `other`) or a group's id.
public struct PlaceTarget: Hashable, Sendable, Identifiable {
    public var label: String
    public var section: String
    public var id: String { section }
    public init(label: String, section: String) { (self.label, self.section) = (label, section) }
}

public enum PlaceEntry: Hashable, Sendable, Identifiable {
    case place(PlaceTarget)
    case project(name: String, items: [PlaceTarget])
    public var id: String {
        switch self {
        case .place(let p): p.section
        case .project(let name, _): "project:\(name)"
        }
    }
}

public struct GroupMove: Hashable, Sendable, Identifiable {
    public var label: String
    /// The project to move to, or nil for Home.
    public var project: String?
    public var id: String { project ?? "home" }
}

public enum OrganiseRules {
    public static let titleMax = 120
    public static let nameMax = 80
    public static let nestSelf = "A session cannot nest under itself or a session nested under it."
    public static let noGroup = "No group"
    public static let stopDetail = "Archiving stops Claude's turn and denies any approval it is waiting for. Undo brings the session back, but not the turn."

    private static let looseHomes = ["capcom": "started", "desktop": "ungrouped", "cli": "other"]
    public static let looseNames = ["started": "Started here", "ungrouped": "Ungrouped", "other": "Terminal and other"]
    public static let loose = ["started", "ungrouped", "other"]

    /// The text the page sends and compares: runs of white space become one space, and the ends are trimmed.
    public static func clean(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// The loose list a session goes back to, which follows the app it came from. A routine run has none.
    public static func looseHome(_ row: SessionRow) -> String? { row.routine != nil ? nil : row.source.flatMap { looseHomes[$0] } }

    // MARK: The tree

    public static func every(_ index: SessionIndex) -> [SessionRow] {
        let lists = [index.pinned] + index.groups.map(\.sessions) + index.routines.map { ($0.latest.map { [$0] } ?? []) + $0.earlier } + [index.started, index.ungrouped, index.other]
        return lists.flatMap { $0.flatMap { [$0] + $0.children } }
    }

    public static func find(_ index: SessionIndex, _ id: String?) -> SessionRow? {
        guard let id else { return nil }
        return every(index).first { $0.id == id }
    }

    public static func root(_ index: SessionIndex, _ id: String) -> SessionRow? {
        let row = find(index, id)
        return find(index, row?.parent) ?? row
    }

    public static func descendants(_ rows: [SessionRow], of id: String) -> [SessionRow] {
        var seen: Set<String> = [id]
        var found: [SessionRow] = []
        var queue = [id]
        while !queue.isEmpty {
            let next = queue.removeFirst()
            for row in rows where row.parent == next && seen.insert(row.id).inserted {
                found.append(row)
                queue.append(row.id)
            }
        }
        return found
    }

    public static func isRunning(_ row: SessionRow) -> Bool { row.state == .working || row.state == .waiting }

    public static func subsRunning(_ rows: [SessionRow], _ id: String) -> Int { descendants(rows, of: id).filter(isRunning).count }

    private static func topLists(_ index: SessionIndex) -> [[SessionRow]] {
        [index.pinned] + index.groups.map(\.sessions) + [index.started, index.ungrouped, index.other]
    }

    // MARK: One session

    public static func sessionTargets(_ index: SessionIndex, _ row: SessionRow) -> [PlaceEntry] {
        let own = row.pinned ? nil : row.group
        let placed = row.pinned || row.group != nil
        let home = placed ? looseHome(row) : nil
        var entries: [PlaceEntry] = []
        if row.routine != nil && placed { entries.append(.place(PlaceTarget(label: "Routines", section: "routines"))) }
        if !row.pinned { entries.append(.place(PlaceTarget(label: "Pinned", section: "pinned"))) }
        entries += groupEntries(index, leaving: { $0 == own })
        if let home { entries.append(.place(PlaceTarget(label: looseNames[home] ?? home, section: home))) }
        return entries
    }

    /// The groups of each project, then the groups of Home, as the Move to menu draws them. A group for which `skip` is true is left out.
    private static func groupEntries(_ index: SessionIndex, leaving skip: (String) -> Bool) -> [PlaceEntry] {
        func groups(_ list: [SessionGroup]) -> [PlaceTarget] { list.filter { !skip($0.id) }.map { PlaceTarget(label: $0.name, section: $0.id) } }
        let projects: [PlaceEntry] = index.projects.compactMap { p in
            let items = groups(index.groups.filter { $0.project == p.id })
            return items.isEmpty ? nil : .project(name: p.name, items: items)
        }
        return projects + groups(index.groups.filter { $0.project == nil }).map { .place($0) }
    }

    /// The other top level sessions in the list a row shows in, with no routine run and not the parent it has already.
    public static func nestTargets(_ index: SessionIndex, _ row: SessionRow) -> [SessionRow] {
        let home = row.parent ?? row.id
        let list = topLists(index).first { $0.contains { $0.id == home } } ?? []
        return list.filter { $0.id != row.id && $0.id != row.parent && $0.routine == nil }
    }

    public static func staysPut(_ index: SessionIndex, _ row: SessionRow, section: String) -> Bool {
        if row.parent != nil { return false }
        if section == "pinned" { return row.pinned }
        if index.groups.contains(where: { $0.id == section }) { return row.group == section && !row.pinned }
        return row.group == nil && !row.pinned
    }

    /// Whether a drop of `row` on another row nests nothing: onto itself or a session below it, or into the family it is in already.
    public static func nestsNothing(_ index: SessionIndex, _ row: SessionRow, under parent: String) -> Bool {
        guard let top = root(index, parent) else { return true }
        return top.id == row.id || row.parent == top.id
    }

    // MARK: Several sessions

    /// The picked sessions that are not under another picked one, which archiving sends because it takes the sessions below along.
    public static func topmost(_ index: SessionIndex, _ ids: [String]) -> [SessionRow] {
        let all = every(index)
        let picked = ids.compactMap { find(index, $0) }
        return picked.filter { r in !picked.contains { o in o.id != r.id && descendants(all, of: o.id).contains { $0.id == r.id } } }
    }

    /// The picked sessions a move or a nest changes on their own: those whose parent is not picked. The others travel with it.
    public static func carried(_ index: SessionIndex, _ ids: [String]) -> [SessionRow] {
        let picked = Set(ids)
        return ids.compactMap { find(index, $0) }.filter { $0.parent.map(picked.contains) != true }
    }

    public static func refuseNest(_ index: SessionIndex, _ ids: [String], under parent: String) -> String? {
        let top = root(index, parent)
        return ids.contains(parent) || (top.map { ids.contains($0.id) } ?? false) ? nestSelf : nil
    }

    private static func placeOf(_ r: SessionRow) -> String? { r.parent != nil ? nil : r.pinned ? "pinned" : r.group ?? "loose" }

    private static func looseTarget(_ rows: [SessionRow]) -> PlaceTarget {
        let homes = Set(rows.filter { $0.routine == nil }.map { looseHome($0) })
        if homes.count == 1, let only = homes.first, let name = only { return PlaceTarget(label: looseNames[name] ?? name, section: name) }
        return PlaceTarget(label: noGroup, section: "ungrouped")
    }

    public static func manyTargets(_ index: SessionIndex, _ rows: [SessionRow]) -> [PlaceEntry] {
        func all(_ place: String) -> Bool { rows.allSatisfy { placeOf($0) == place } }
        let placed = { (r: SessionRow) in r.pinned || r.group != nil || r.parent != nil }
        let loose = rows.contains { $0.routine == nil && placed($0) }
        var entries: [PlaceEntry] = []
        if !rows.isEmpty && rows.allSatisfy({ $0.routine != nil }) && rows.contains(where: placed) { entries.append(.place(PlaceTarget(label: "Routines", section: "routines"))) }
        if !all("pinned") { entries.append(.place(PlaceTarget(label: "Pinned", section: "pinned"))) }
        entries += groupEntries(index, leaving: all)
        if loose { entries.append(.place(looseTarget(rows))) }
        return entries
    }

    public static func manyNestTargets(_ index: SessionIndex, _ ids: [String]) -> [SessionRow] {
        topLists(index).flatMap { $0 }.filter { !ids.contains($0.id) && $0.routine == nil }
    }

    public static func target(_ index: SessionIndex, section: String) -> ManyTarget {
        section == "pinned" ? .pinned : .group(index.groups.contains { $0.id == section } ? section : nil)
    }

    /// What the notes call the place a section stands for.
    public static func placeName(_ index: SessionIndex, _ rows: [SessionRow], section: String) -> String {
        if section == "pinned" { return "Pinned" }
        if section == "routines" { return "Routines" }
        return index.groups.first { $0.id == section }?.name ?? looseTarget(rows).label
    }

    public static func changesNothing(_ index: SessionIndex, _ ids: [String], _ to: ManyTarget) -> Bool {
        let rows = carried(index, ids)
        switch to {
        case .parent(let parent?):
            if refuseNest(index, ids, under: parent) != nil { return true }
            return rows.allSatisfy { nestsNothing(index, $0, under: parent) }
        case .parent(nil): return rows.allSatisfy { $0.parent == nil }
        case .pinned: return rows.allSatisfy { staysPut(index, $0, section: "pinned") }
        case .group(let group): return rows.allSatisfy { staysPut(index, $0, section: group ?? looseHome($0) ?? "ungrouped") }
        }
    }

    /// The nested rows a Move out takes out, and the parent when they all have one.
    public static func leavers(_ index: SessionIndex, _ rows: [SessionRow]) -> (rows: [SessionRow], parent: SessionRow?) {
        let nested = rows.filter { $0.parent != nil }
        let parents = Set(nested.compactMap(\.parent))
        return (nested, parents.count == 1 ? find(index, parents.first) : nil)
    }

    // MARK: Groups and projects

    public static func moveTargets(_ projects: [SessionProject], _ group: SessionGroup) -> [GroupMove] {
        (group.project != nil ? [GroupMove(label: "Move to Home", project: nil)] : [])
            + projects.filter { $0.id != group.project }.map { GroupMove(label: "Move to \($0.name)", project: $0.id) }
    }

    public static func groups(_ index: SessionIndex, view: String?) -> [SessionGroup] {
        let shown = SidebarOutline.view(view, in: index)
        return index.groups.filter { SidebarOutline.view($0.project, in: index) == shown }
    }

    /// What the question before a group is deleted says: where its sessions go, what happens to its chat, and that nothing is deleted.
    public static func deleteDetail(_ group: SessionGroup) -> String {
        let count = group.sessions.reduce(0) { $0 + 1 + $1.children.count }
        let lit = group.session.flatMap { s -> SessionState? in s.state == .working || s.state == .waiting ? s.state : nil }
        var parts = [count == 0 ? "It has no sessions." : count == 1 ? "1 session becomes ungrouped." : "\(count) sessions become ungrouped."]
        if group.session != nil {
            parts.append(lit.map { "Its chat is \($0 == .waiting ? "waiting for you" : "working"), so it stops, and is hidden with its transcript kept." } ?? "Its chat is hidden, and its transcript is kept.")
        }
        if count > 0 || group.session != nil { parts.append("No session is deleted.") }
        return parts.joined(separator: " ")
    }

    public static func deleteDetail(_ project: SessionProject, in index: SessionIndex) -> String {
        let n = index.groups.filter { $0.project == project.id }.count
        return n == 0 ? "It has no groups." : "Its \(n == 1 ? "group moves" : "\(n) groups move") to Home. No group or session is deleted."
    }

    // MARK: Words

    public static func sessions(_ n: Int) -> String { n == 1 ? "1 session" : "\(n) sessions" }
    public static func subSessions(_ n: Int) -> String { "\(n) sub session\(n == 1 ? "" : "s")" }
    public static func withSubs(_ n: Int) -> String { n > 0 ? " and \(subSessions(n))" : "" }

    public static func movedNote(_ n: Int, to place: String) -> String { "Moved \(sessions(n)) to \(place)." }
    public static func pinnedNote(_ n: Int) -> String { "Pinned \(sessions(n))." }
    public static func nestedNote(_ n: Int, under title: String) -> String { "Nested \(sessions(n)) under \u{201C}\(title)\u{201D}." }
    public static func unnestedNote(_ n: Int) -> String { "Moved \(sessions(n)) out of \(n == 1 ? "its parent" : "their parents")." }

    /// What the question says before archiving one session whose family has sessions running or waiting on the owner. `itself` is whether the session is one of them.
    public static func familyDetail(subs: Int, itself: Bool) -> String {
        let one = subs == 1
        if itself { return "It and \(subSessions(subs)) under it are running or waiting on you. Archiving stops them and denies any approval they are waiting for. Undo brings the sessions back, but not the turns." }
        return "\(one ? "1 sub session is" : "\(subs) sub sessions are") running or waiting on you. Archiving stops \(one ? "it" : "them") and denies any approval \(one ? "it is" : "they are") waiting for. Undo brings the sessions back, but not the \(one ? "turn" : "turns")."
    }

    public static func stopQuestion(subs: Int, itself: Bool) -> String { subs > 0 ? familyDetail(subs: subs, itself: itself) : stopDetail }

    /// What the question before a batch says: how many are running, and what archiving them does. `subs` is how many sessions below them are running too.
    public static func batchStopDetail(running: Int, subs: Int = 0) -> String {
        let n = running + subs
        let one = n == 1
        if subs > 0 {
            return "\(one ? "1 session is" : "\(n) sessions are") running or waiting on you, \(running > 0 ? "\(subs) of them under a picked session" : "all under a picked session"). Archiving stops Claude's turn in \(one ? "it" : "each") and denies any approval it is waiting for. Undo brings the sessions back, but not the \(one ? "turn" : "turns")."
        }
        return "\(one ? "1 of them is running" : "\(running) of them are running"). Archiving stops Claude's turn in \(one ? "it" : "each") and denies any approval it is waiting for. Undo brings the sessions back, but not the \(one ? "turn" : "turns")."
    }

    private static func sentence(_ text: String) -> String { text.last.map { ".!?".contains($0) } == true ? text : "\(text)." }

    /// `name` words a lone archived session by its title, as the page does.
    public static func archiveNote(archived: Int, total: Int, stopped: Int = 0, subs: Int = 0, reason: String = "", name: String? = nil) -> String {
        let stops = stopped > 0 ? "\(subs > 0 ? "," : "") and stopped \(stopped)" : ""
        if archived == total { return "Archived \(total == 1 ? name.map { "\u{201C}\($0)\u{201D}" } ?? sessions(total) : sessions(total))\(withSubs(subs))\(stops)." }
        if archived == 0 { return "Not archived: \(sentence(reason))" }
        return "Archived \(archived) of \(sessions(total))\(withSubs(subs))\(stops). Not archived: \(sentence(reason))"
    }

    // MARK: Account pins

    public static let pickNote = "Takes effect at the next start. A running turn keeps its account."
    public static let chromeNote = "Chrome works only on the account its extension is signed into."

    /// One line of the Account menu. `account` is what picking it pins, nil meaning the active account. A checked line, or a disabled one, picks nothing.
    public struct AccountChoice: Hashable, Sendable, Identifiable {
        public var id: String
        public var label: String
        public var account: String?
        public var checked: Bool
        public var picks: Bool
    }

    public static func accountName(_ accounts: [Account], _ id: String?) -> String { accounts.first { $0.id == id }?.name ?? "" }

    private static func chromeOnName(_ accounts: [Account], _ a: Account) -> String { a.chromeOn.map { accountName(accounts, $0) } ?? "" }

    /// The page's pick: shown when the server pins and there is a choice to make, or something is already pinned.
    public static func offersAccountPick(_ features: SessionFeatures?, _ accounts: [Account]?, pin: String?) -> Bool {
        features?.accountPins == true && accounts != nil && (pin != nil || (accounts?.count ?? 0) > 1)
    }

    /// Whom "Active account" runs as: nobody in particular when the session holds its own pin.
    public static func accountFollows(_ accounts: [Account], _ row: SessionRow) -> String { row.accountPin != nil ? "" : accountName(accounts, row.account) }

    public static func accountChoices(_ accounts: [Account], pin: String?, follows: String) -> [AccountChoice] {
        let listed = accounts.map { a -> AccountChoice in
            let note = a.signedOut ? " (signed out)" : !chromeOnName(accounts, a).isEmpty ? " (no Chrome)" : ""
            return AccountChoice(id: a.id, label: a.name + note, account: a.id, checked: a.id == pin, picks: a.id != pin && !(a.signedOut))
        }
        let removed = pin.flatMap { id in accountName(accounts, id).isEmpty ? AccountChoice(id: id, label: "Removed account", account: id, checked: true, picks: false) : nil }
        return [AccountChoice(id: "", label: follows.isEmpty ? "Active account" : "Active account (\(follows))", account: nil, checked: pin == nil, picks: pin != nil)] + listed + (removed.map { [$0] } ?? [])
    }

    /// The line under the pick: definite when the survey found Chrome on another account, else the static limit.
    public static func accountChromeNote(_ accounts: [Account]) -> String {
        let name = accounts.map { chromeOnName(accounts, $0) }.first { !$0.isEmpty }
        return name.map { "Chrome is on \($0), so work on another account can't reach it." } ?? chromeNote
    }
}
