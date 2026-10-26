import AVFoundation
import AppKit
import Foundation

func usage() -> Never {
    fputs("usage: analyze_video.swift <video> <output-dir> <interval-seconds> [width]\n", stderr)
    exit(2)
}

guard CommandLine.arguments.count >= 4 else { usage() }

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
guard let interval = Double(CommandLine.arguments[3]), interval > 0 else { usage() }
let width = CommandLine.arguments.count >= 5 ? Int(CommandLine.arguments[4]) ?? 970 : 970

try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

let asset = AVURLAsset(url: input)
let duration = CMTimeGetSeconds(asset.duration)
guard duration.isFinite && duration > 0 else {
    fputs("invalid duration\n", stderr)
    exit(1)
}

let videoTrack = asset.tracks(withMediaType: .video).first
let naturalSize = videoTrack?.naturalSize ?? .zero
let transformedSize: CGSize
if let track = videoTrack {
    transformedSize = naturalSize.applying(track.preferredTransform)
} else {
    transformedSize = naturalSize
}

print("duration_seconds=\(String(format: "%.6f", duration))")
print("natural_size=\(Int(abs(naturalSize.width)))x\(Int(abs(naturalSize.height)))")
print("display_size=\(Int(abs(transformedSize.width)))x\(Int(abs(transformedSize.height)))")
print("nominal_fps=\(String(format: "%.3f", videoTrack?.nominalFrameRate ?? 0))")
print("estimated_data_rate=\(String(format: "%.0f", videoTrack?.estimatedDataRate ?? 0))")

let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.maximumSize = CGSize(width: width, height: width * 2)
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

var second = 0.0
var count = 0
while second <= duration {
    let requested = CMTime(seconds: min(second, max(0, duration - 0.001)), preferredTimescale: 600)
    var actual = CMTime.zero
    do {
        let image = try generator.copyCGImage(at: requested, actualTime: &actual)
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            throw NSError(domain: "analyze_video", code: 1)
        }
        let millis = Int((CMTimeGetSeconds(actual) * 1000).rounded())
        let name = String(format: "frame_%07dms.png", millis)
        try data.write(to: output.appendingPathComponent(name))
        print("frame=\(name) requested=\(String(format: "%.3f", second)) actual=\(String(format: "%.3f", CMTimeGetSeconds(actual)))")
        count += 1
    } catch {
        fputs("frame_error requested=\(second) error=\(error)\n", stderr)
    }
    second += interval
}

print("frames_written=\(count)")
