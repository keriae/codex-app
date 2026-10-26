import Foundation
import ImageIO
import Vision

guard CommandLine.arguments.count >= 2 else {
    fputs("usage: ocr_images.swift <image> [image ...]\n", stderr)
    exit(2)
}

for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path) as CFURL
    guard let source = CGImageSourceCreateWithURL(url, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fputs("cannot_read \(path)\n", stderr)
        continue
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    let handler = VNImageRequestHandler(cgImage: image)
    do {
        try handler.perform([request])
        let observations = (request.results ?? []).sorted {
            let rowDifference = abs($0.boundingBox.midY - $1.boundingBox.midY)
            if rowDifference > 0.008 { return $0.boundingBox.midY > $1.boundingBox.midY }
            return $0.boundingBox.minX < $1.boundingBox.minX
        }
        print("=== \((path as NSString).lastPathComponent) ===")
        for observation in observations {
            guard let candidate = observation.topCandidates(1).first else { continue }
            let b = observation.boundingBox
            print(String(format: "%.4f %.4f %.4f %.4f\t%@", b.minX, b.minY, b.width, b.height, candidate.string))
        }
    } catch {
        fputs("ocr_error \(path) \(error)\n", stderr)
    }
}
