import Foundation

/// A time as the server writes it, such as `2026-10-16T07:42:17+11:00`. It keeps the original text and the offset in it, because the words for a time
/// ("Today, 07:42") are read off the Mac's own wall clock and not the device's.
public struct LocalTime: Hashable, Sendable, Decodable {
    public let iso: String
    public let year: Int
    public let month: Int
    public let day: Int
    public let hour: Int
    public let minute: Int
    let second: Int
    /// Minutes east of UTC, or nil for a string with no offset, which is read in the device's zone.
    public let offsetMinutes: Int?

    /// Nil for anything that is not `YYYY-MM-DDTHH:mm`, with optional seconds, a fraction and an offset (`Z`, `+11:00` or `+1100`).
    public init?(_ iso: String) {
        let b = Array(iso.utf8)
        func digits(_ from: Int, _ count: Int) -> Int? {
            guard from + count <= b.count else { return nil }
            var value = 0
            for i in from..<from + count {
                guard b[i] >= 48, b[i] <= 57 else { return nil }
                value = value * 10 + Int(b[i] - 48)
            }
            return value
        }
        guard b.count >= 16, b[4] == 45, b[7] == 45, b[10] == 84, b[13] == 58,
              let y = digits(0, 4), let mo = digits(5, 2), let d = digits(8, 2), let h = digits(11, 2), let mi = digits(14, 2),
              (1...12).contains(mo), (1...31).contains(d), h < 24, mi < 60 else { return nil }
        var i = 16
        var s = 0
        if i < b.count, b[i] == 58 {
            guard let sec = digits(i + 1, 2), sec < 60 else { return nil }
            s = sec
            i += 3
            if i < b.count, b[i] == 46 {
                i += 1
                let start = i
                while i < b.count, b[i] >= 48, b[i] <= 57 { i += 1 }
                guard i > start else { return nil }
            }
        }
        var offset: Int?
        if i < b.count {
            if b[i] == 90 {
                offset = 0
                i += 1
            } else if b[i] == 43 || b[i] == 45 {
                let sign = b[i] == 45 ? -1 : 1
                guard let oh = digits(i + 1, 2) else { return nil }
                i += 3
                if i < b.count, b[i] == 58 { i += 1 }
                guard let om = digits(i, 2) else { return nil }
                i += 2
                offset = sign * (oh * 60 + om)
            }
        }
        guard i == b.count else { return nil }
        (self.iso, year, month, day, hour, minute, second, offsetMinutes) = (iso, y, mo, d, h, mi, s, offset)
    }

    public init(from decoder: Decoder) throws {
        let text = try decoder.singleValueContainer().decode(String.self)
        guard let time = LocalTime(text) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a local time.")) }
        self = time
    }

    /// The instant it names. A string with no offset is read in the device's zone, as `Date.parse` does.
    public var date: Date {
        let wall = Double(Self.days(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second)
        if let offsetMinutes { return Date(timeIntervalSince1970: wall - Double(offsetMinutes * 60)) }
        let parts = DateComponents(year: year, month: month, day: day, hour: hour, minute: minute, second: second)
        return Calendar.current.date(from: parts) ?? Date(timeIntervalSince1970: wall)
    }

    // MARK: Calendar arithmetic, in plain days so the Mac's offset is applied by hand

    /// Days from 1970-01-01 to a civil date.
    static func days(_ year: Int, _ month: Int, _ day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    /// The civil date `days` after 1970-01-01.
    static func civil(_ days: Int) -> (year: Int, month: Int, day: Int) {
        let z = days + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let day = doy - (153 * mp + 2) / 5 + 1
        let month = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (month <= 2 ? 1 : 0), month, day)
    }

    /// 0 for Sunday.
    static func weekday(_ days: Int) -> Int { (((days + 4) % 7) + 7) % 7 }
}
