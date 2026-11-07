import CoreGraphics
import Foundation
import GhostShellKit
import Observation
import UniformTypeIdentifiers

/// A picture or a file on its way into a message. A picture is scaled before it shows as ready, and a file is uploaded.
struct Attachment: Identifiable {
    let id = UUID()
    var name: String
    var size: Int
    let isPicture: Bool
    var image: PreparedImage?
    var thumbnail: CGImage?
    var file: UploadedFile?
    var working = true
}

/// Bytes with the name they came with, from a file, a paste or a drop.
struct Incoming: Sendable {
    var name: String
    var data: Data

    /// Reads files off the main actor, so a large one does not stall typing.
    static func read(_ urls: [URL]) async -> [Incoming] {
        await Task.detached {
            urls.compactMap { url -> Incoming? in
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url) else { return nil }
                return Incoming(name: url.lastPathComponent, data: data)
            }
        }.value
    }
}

/// What the composer keeps beyond one visit to a chat: the unsent text of each session, the pictures and files attached to each, the quotes (one set for
/// the whole app) and the lists the server answered. The text sits in UserDefaults so a relaunch finds it, and the rest lives as long as the app.
/// See docs/adr/20261102-a-draft-for-each-session.md.
@Observable @MainActor
final class ComposerStore {
    static let shared = ComposerStore()

    private(set) var attachments: [String: [Attachment]] = [:]
    private(set) var quotes: [Quote] = []
    private(set) var commandLists: [String: (at: Date, list: [SlashCommand])] = [:]
    private(set) var modelLists: [String: [ListedModel]] = [:]
    private(set) var limitsKnown = false
    private(set) var limits: UploadLimits?
    @ObservationIgnored private var texts = DraftTexts(.standard)
    @ObservationIgnored private var counter = 0

    /// Points the saved text at the suite the app uses, which a Debug run sets with `-GSDefaultsSuite`.
    func bind(_ defaults: UserDefaults) { texts = DraftTexts(defaults) }

    /// Sign-out forgets everything a person typed or attached.
    func clearAll() {
        texts.clear()
        attachments = [:]
        quotes = []
        commandLists = [:]
        modelLists = [:]
        (limitsKnown, limits) = (false, nil)
    }

    // MARK: Text

    func text(for id: String) -> String { texts.text(for: id) }
    func setText(_ text: String, for id: String) { texts.set(text, for: id) }

    // MARK: Quotes

    /// The same words from the same session are one quote.
    func addQuote(_ raw: String, fromID: String, fromTitle: String) {
        let text = QuoteRules.clean(raw)
        guard !text.isEmpty, !quotes.contains(where: { $0.text == text && $0.fromID == fromID }) else { return }
        counter += 1
        quotes.append(Quote(key: "quote\(counter)", text: text, fromID: fromID, fromTitle: fromTitle))
    }

    func removeQuote(_ key: String) { quotes.removeAll { $0.key == key } }
    func setQuotes(_ list: [Quote]) { quotes = list }

    // MARK: Lists the server answers

    func store(commands: [SlashCommand], for key: String) { commandLists[key] = (Date(), commands) }
    func store(models: [ListedModel], for key: String) { modelLists[key] = models }

    // MARK: Attachments

    func remove(_ id: UUID, from draft: String) { attachments[draft]?.removeAll { $0.id == id } }

    /// Puts back what a failed send took out, ahead of anything attached meanwhile.
    func restore(_ list: [Attachment], to draft: String) { attachments[draft] = list + (attachments[draft] ?? []) }

    func takeAttachments(from draft: String) -> [Attachment] {
        let held = attachments[draft] ?? []
        attachments[draft] = nil
        return held
    }

    private func update(_ id: UUID, in draft: String, _ change: (inout Attachment) -> Void) {
        guard let n = attachments[draft]?.firstIndex(where: { $0.id == id }) else { return }
        change(&attachments[draft]![n])
    }

    /// Whether this server takes files that are not pictures. Asked once, and a failure means pictures only.
    private func uploadLimits(_ client: GhostShellClient) async -> UploadLimits? {
        if !limitsKnown {
            let found = await client.uploadLimits()
            (limitsKnown, limits) = (true, found)
        }
        return limits
    }

    /// Takes the items in order into the draft `draft`. A picture is scaled to what the server takes and anything else is uploaded. The chip shows at once,
    /// and the result lands in that draft whichever chat is open by then. `notice` hears each thing that was left out.
    func attach(_ items: [Incoming], to draft: String, client: GhostShellClient, notice: @escaping @MainActor (String) -> Void) async {
        let limits = items.contains { !ImagePreparer.isPicture($0.data) } ? await uploadLimits(client) : self.limits
        var work: [Task<Void, Never>] = []
        for item in items {
            let held = attachments[draft] ?? []
            if ImagePreparer.isPicture(item.data) {
                guard held.filter(\.isPicture).count < ImagePreparer.maxImages else { notice("A message can hold up to \(ImagePreparer.maxImages) images."); continue }
                let entry = Attachment(name: item.name, size: item.data.count, isPicture: true)
                attachments[draft, default: []].append(entry)
                work.append(Task { await self.prepare(item, entry.id, in: draft, notice: notice) })
            } else {
                guard let limits else { notice("\(item.name) is not an image, and this server only takes images."); continue }
                guard item.data.count <= limits.maxBytes else { notice("\(item.name) is over the \(limits.maxBytes / 1_048_576) MB limit."); continue }
                guard held.filter({ !$0.isPicture }).count < limits.maxFiles else { notice("A message can hold up to \(limits.maxFiles) files."); continue }
                let entry = Attachment(name: item.name, size: item.data.count, isPicture: false)
                attachments[draft, default: []].append(entry)
                work.append(Task { await self.upload(item, entry.id, in: draft, client: client, notice: notice) })
            }
        }
        for task in work { await task.value }
    }

    private func prepare(_ item: Incoming, _ id: UUID, in draft: String, notice: @MainActor (String) -> Void) async {
        let result = await Task.detached { () -> Result<(PreparedImage, CGImage?), Error> in
            Result { let image = try ImagePreparer.prepare(item.data, name: item.name); return (image, ImagePreparer.thumbnail(image.data, longEdge: 120)) }
        }.value
        switch result {
        case .success(let (image, thumb)):
            update(id, in: draft) { ($0.image, $0.thumbnail, $0.size, $0.working) = (image, thumb, image.data.count, false) }
        case .failure(let error):
            remove(id, from: draft)
            notice(error.localizedDescription)
        }
    }

    private func upload(_ item: Incoming, _ id: UUID, in draft: String, client: GhostShellClient, notice: @MainActor (String) -> Void) async {
        let type = UTType(filenameExtension: (item.name as NSString).pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        do {
            let saved = try await client.uploadFile(item.data, name: item.name, type: type)
            update(id, in: draft) { ($0.file, $0.size, $0.working) = (saved, saved.size, false) }
        } catch {
            remove(id, from: draft)
            notice("\(item.name) could not be uploaded. \(ComposerWords.failure(error))")
        }
    }
}
