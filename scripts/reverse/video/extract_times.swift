import AVFoundation
import AppKit
import Foundation

guard CommandLine.arguments.count >= 4 else {
    fputs("usage: extract_times.swift <video> <output-dir> <seconds> [seconds ...]\n", stderr)
    exit(2)
}

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let times = CommandLine.arguments.dropFirst(3).compactMap(Double.init)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

let asset = AVURLAsset(url: input)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

for second in times {
    let requested = CMTime(seconds: second, preferredTimescale: 600)
    var actual = CMTime.zero
    do {
        let image = try generator.copyCGImage(at: requested, actualTime: &actual)
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            throw NSError(domain: "extract_times", code: 1)
        }
        let millis = Int((CMTimeGetSeconds(actual) * 1000).rounded())
        let name = String(format: "frame_%07dms.png", millis)
        try data.write(to: output.appendingPathComponent(name))
        print("\(name) \(image.width)x\(image.height)")
    } catch {
        fputs("frame_error requested=\(second) error=\(error)\n", stderr)
    }
}
