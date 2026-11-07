import CoreGraphics
import Foundation
import ImageIO

/// A picture ready to send: one of the four types the server takes, within its size limits.
public struct PreparedImage: Hashable, Sendable {
    public var mediaType: String
    public var data: Data
    public var width: Int
    public var height: Int

    public var outgoing: OutgoingImage { OutgoingImage(mediaType: mediaType, data: data.base64EncodedString()) }
}

/// Scales a picture down to what the server accepts. This mirrors `prepare` in public/ui/images.js, which mirrors the checks in lib/images.mjs.
public enum ImagePreparer {
    public static let maxImages = 10
    public static let maxEdge = 2000
    /// The API takes 5 MB per image. 3.75 MB of image is 5 MB as base64, so it fits however the API counts.
    public static let maxBytes = 5 * 1024 * 1024 * 3 / 4

    public enum Failure: Error, Equatable, LocalizedError {
        case unreadable(String)
        case tooBig(String)

        public var errorDescription: String? {
            switch self {
            case .unreadable(let name): "\(name) could not be read as an image."
            case .tooBig(let name): "\(name) could not be made small enough to send."
            }
        }
    }

    /// The type the first bytes say, or nil for anything that is not PNG, JPEG, GIF or WebP.
    public static func sniff(_ data: Data) -> String? {
        let head = [UInt8](data.prefix(12))
        if head.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) { return "image/png" }
        if head.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if head.starts(with: Array("GIF87a".utf8)) || head.starts(with: Array("GIF89a".utf8)) { return "image/gif" }
        if head.count == 12, head.starts(with: Array("RIFF".utf8)), Array(head[8..<12]) == Array("WEBP".utf8) { return "image/webp" }
        return nil
    }

    /// A picture within both limits goes as it is, which keeps an animated GIF animated. Anything else, such as a HEIC photo, is redrawn: as a PNG
    /// first so a screenshot stays sharp, then as a JPEG at 0.9, 0.75 and 0.6, then smaller by a quarter and again, until it fits.
    public static func prepare(_ data: Data, name: String = "That file", maxEdge: Int = maxEdge, maxBytes: Int = maxBytes) throws -> PreparedImage {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int, let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0 else { throw Failure.unreadable(name) }
        let native = sniff(data)
        let long = max(width, height)
        let shrink = min(1.0, Double(maxEdge) / Double(long))
        if let native, shrink == 1, data.count <= maxBytes { return PreparedImage(mediaType: native, data: data, width: width, height: height) }
        // A JPEG, or a type the server does not take, is a photograph, so it skips the PNG try.
        let photo = native == "image/jpeg" || native == nil
        var scale = 1.0
        while true {
            let target = max(1, Int((Double(long) * shrink * scale).rounded()))
            guard let drawn = draw(source, longEdge: target) else { throw Failure.unreadable(name) }
            if !photo, let png = encode(drawn, type: "public.png", quality: nil), png.count <= maxBytes {
                return PreparedImage(mediaType: "image/png", data: png, width: drawn.width, height: drawn.height)
            }
            if let flat = flatten(drawn) {
                for quality in [0.9, 0.75, 0.6] {
                    if let jpeg = encode(flat, type: "public.jpeg", quality: quality), jpeg.count <= maxBytes {
                        return PreparedImage(mediaType: "image/jpeg", data: jpeg, width: flat.width, height: flat.height)
                    }
                }
            }
            if max(drawn.width, drawn.height) < 200 { throw Failure.tooBig(name) }
            scale *= 0.75
        }
    }

    /// The picture's long edge at `longEdge` pixels, turned the right way up. The thumbnail call does both in one pass.
    static func draw(_ source: CGImageSource, longEdge: Int) -> CGImage? {
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                                        kCGImageSourceThumbnailMaxPixelSize: longEdge, kCGImageSourceShouldCacheImmediately: true]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    /// A JPEG has no transparency, so the picture goes onto white.
    private static func flatten(_ image: CGImage) -> CGImage? {
        guard let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: image.width, height: image.height))
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return context.makeImage()
    }

    private static func encode(_ image: CGImage, type: String, quality: Double?) -> Data? {
        let out = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(out, type as CFString, 1, nil) else { return nil }
        let options: [CFString: Any] = quality.map { [kCGImageDestinationLossyCompressionQuality: $0] } ?? [:]
        CGImageDestinationAddImage(destination, image, options as CFDictionary)
        return CGImageDestinationFinalize(destination) ? out as Data : nil
    }

    /// A small picture for a chip, or nil when the bytes are not an image.
    public static func thumbnail(_ data: Data, longEdge: Int) -> CGImage? {
        CGImageSourceCreateWithData(data as CFData, nil).flatMap { draw($0, longEdge: longEdge) }
    }
}
