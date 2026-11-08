import Foundation

// Ported from public/ui/passkeys.js. Change them together.

public func passkeyDate(_ date: Date?) -> String {
    guard let date else { return "" }
    return date.formatted(.dateTime.day().month(.abbreviated).year())
}

public func passkeyDevice(_ p: Passkey) -> String { p.device.isEmpty ? "Unknown browser" : p.device }

public func lastUsedWords(_ used: Date?, now: Date = Date(), calendar: Calendar = .current) -> String {
    guard let used else { return "Never used" }
    let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: used), to: calendar.startOfDay(for: now)).day ?? 0
    if days <= 0 { return "Used today" }
    if days == 1 { return "Used yesterday" }
    return days < 30 ? "Used \(days) days ago" : "Used \(passkeyDate(used))"
}

public let passkeyLead = "A passkey signs you in with a fingerprint, face or screen lock. The password keeps working."
public let passkeyFootnote = "Removing a passkey here stops it signing in. Delete it from the device or password manager that holds it as well."
public let passkeyUnavailable = "This address is not in passkeyOrigins, so GhostShell cannot use passkeys here."
