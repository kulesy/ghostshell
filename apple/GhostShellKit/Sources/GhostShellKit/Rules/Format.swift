import Foundation

// Ported from public/ui/format.js, so a figure reads the same in the app and on the page.

func plural(_ n: Int, _ one: String, _ many: String) -> String { "\(n) \(n == 1 ? one : many)" }

/// The context meter's tokens, always in thousands to one decimal: 14300 is 14.3k and 500 is 0.5k.
public func thousands(_ n: Int) -> String { String(format: "%.1fk", Double(n) / 1000) }

/// A window is a round figure, so it drops a zero decimal: 300000 is 300k and 1000000 is 1M.
public func windowSize(_ n: Int) -> String {
    let tenths = Int((Double(n) / 100).rounded())
    if tenths >= 10_000 {
        let millions = String(format: "%.1f", Double(tenths) / 10_000)
        return "\(millions.hasSuffix(".0") ? String(millions.dropLast(2)) : millions)M"
    }
    return tenths % 10 == 0 ? "\(tenths / 10)k" : "\(Double(tenths) / 10)k"
}

public func grouped(_ n: Int) -> String { n.formatted(.number.locale(Locale(identifier: "en_US"))) }

private let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
private let monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
private func pad(_ n: Int) -> String { String(format: "%02d", n) }

/// "Fri 6 Nov, 09:36", in English whatever the Mac's language, as the page writes it.
public func endWords(_ date: Date, calendar: Calendar = .current) -> String {
    let c = calendar.dateComponents([.weekday, .day, .month, .hour, .minute], from: date)
    return "\(dayNames[(c.weekday ?? 1) - 1]) \(c.day ?? 1) \(monthNames[(c.month ?? 1) - 1]), \(pad(c.hour ?? 0)):\(pad(c.minute ?? 0))"
}

/// Calendar days from today to the day of `date`.
public func daysLeft(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> Int {
    let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
    return days
}
