import AudioToolbox
import AVFoundation
import Foundation

private struct Options {
    let preset: String
    let events: String
    let output: String
    let sampleRate: Double
    let blockSize: AVAudioFrameCount
    let totalFrames: AVAudioFramePosition
}

private struct Event {
    let frame: AVAudioFramePosition
    let kind: Int
    let id: Int
    let a: Double
    let b: Double
}

private enum RenderError: Error, CustomStringConvertible {
    case message(String)

    var description: String {
        switch self {
        case .message(let text): return text
        }
    }
}

private func usage(_ program: String) {
    FileHandle.standardError.write(Data("usage: \(program) --preset FILE --events FILE --out FILE --sr HZ --block N --frames N\n".utf8))
}

private func parseOptions() -> Options? {
    let args = CommandLine.arguments
    var values: [String: String] = [:]
    var index = 1
    while index < args.count {
        guard index + 1 < args.count else { return nil }
        values[args[index]] = args[index + 1]
        index += 2
    }
    let allowed = Set(["--preset", "--events", "--out", "--sr", "--block", "--frames"])
    guard Set(values.keys).isSubset(of: allowed),
          let preset = values["--preset"],
          let events = values["--events"],
          let output = values["--out"],
          let srText = values["--sr"], let sampleRate = Double(srText), sampleRate > 0,
          let blockText = values["--block"], let block = UInt32(blockText), block > 0,
          let framesText = values["--frames"], let frames = Int64(framesText), frames > 0 else {
        return nil
    }
    return Options(preset: preset, events: events, output: output, sampleRate: sampleRate,
                   blockSize: AVAudioFrameCount(block), totalFrames: AVAudioFramePosition(frames))
}

private func loadPreset(_ path: String) throws -> [(AUParameterAddress, AUValue)] {
    let text = try String(contentsOfFile: path, encoding: .utf8)
    return try text.split(whereSeparator: \.isNewline).compactMap { rawLine in
        let line = rawLine.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)[0]
            .trimmingCharacters(in: .whitespaces)
        if line.isEmpty { return nil }
        let fields = line.split(separator: "=", maxSplits: 1).map(String.init)
        guard fields.count == 2,
              let address = UInt64(fields[0].trimmingCharacters(in: .whitespaces)),
              let value = Float(fields[1].trimmingCharacters(in: .whitespaces)) else {
            throw RenderError.message("プリセットを解析できない: \(rawLine)")
        }
        return (AUParameterAddress(address), AUValue(value))
    }
}

private func loadEvents(_ path: String) throws -> [Event] {
    let text = try String(contentsOfFile: path, encoding: .utf8)
    var result: [Event] = []
    for rawLine in text.split(whereSeparator: \.isNewline) {
        let line = rawLine.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)[0]
            .trimmingCharacters(in: .whitespaces)
        if line.isEmpty { continue }
        let fields = line.split(whereSeparator: \.isWhitespace)
        guard fields.count == 5,
              let frame = Int64(fields[0]), let kind = Int(fields[1]), let id = Int(fields[2]),
              let a = Double(fields[3]), let b = Double(fields[4]), frame >= 0 else {
            throw RenderError.message("イベントを解析できない: \(rawLine)")
        }
        result.append(Event(frame: frame, kind: kind, id: id, a: a, b: b))
    }
    return result.sorted { $0.frame < $1.frame }
}

private func instantiate(_ description: AudioComponentDescription) throws -> AVAudioUnit {
    let semaphore = DispatchSemaphore(value: 0)
    var result: AVAudioUnit?
    var resultError: Error?
    AVAudioUnit.instantiate(with: description, options: []) { unit, error in
        result = unit
        resultError = error
        semaphore.signal()
    }
    semaphore.wait()
    if let result { return result }
    throw resultError ?? RenderError.message("AU の読み込みに失敗した")
}

private func db(_ value: Double) -> Double {
    value > 0 ? 20.0 * log10(value) : -.infinity
}

private func warn(_ text: String) {
    FileHandle.standardError.write(Data("warning: \(text)\n".utf8))
}

private func run(_ options: Options) throws -> Int32 {
    let target = AudioComponentDescription(componentType: kAudioUnitType_MusicDevice,
                                           componentSubType: fourCC("Sken"),
                                           componentManufacturer: fourCC("Arat"),
                                           componentFlags: 0, componentFlagsMask: 0)
    let components = AVAudioUnitComponentManager.shared().components(matching: target)
    guard !components.isEmpty else {
        FileHandle.standardError.write(Data("error: AU が登録されていない。先に shells/apple/build.sh を実行し、署名済み AU を登録してください。\n".utf8))
        return 2
    }

    let unit = try instantiate(target)
    guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                     sampleRate: options.sampleRate,
                                     channels: 2, interleaved: false) else {
        throw RenderError.message("出力フォーマットを作成できない")
    }
    let engine = AVAudioEngine()
    engine.attach(unit)
    engine.connect(unit, to: engine.mainMixerNode, format: format)
    try engine.enableManualRenderingMode(.offline, format: format,
                                         maximumFrameCount: options.blockSize)

    guard let tree = unit.auAudioUnit.parameterTree else {
        throw RenderError.message("AU に parameterTree がない")
    }
    let parameters = Dictionary(uniqueKeysWithValues: tree.allParameters.map { ($0.address, $0) })
    for (address, value) in try loadPreset(options.preset) {
        if let parameter = parameters[address] {
            parameter.value = value
        } else {
            warn("AU parameter address \(address) がないため preset 値を適用できない")
        }
    }
    let events = try loadEvents(options.events)
    guard let scheduleMIDI = unit.auAudioUnit.scheduleMIDIEventBlock else {
        throw RenderError.message("AU が MIDI イベント予約に対応していない")
    }
    guard let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat,
                                        frameCapacity: options.blockSize) else {
        throw RenderError.message("レンダーバッファを作成できない")
    }
    let outputFile = try AVAudioFile(forWriting: URL(fileURLWithPath: options.output),
                                     settings: format.settings,
                                     commonFormat: .pcmFormatFloat32,
                                     interleaved: false)

    engine.prepare()
    try engine.start()
    defer { engine.stop() }

    var eventIndex = 0
    var noteByID: [Int: UInt8] = [:]
    var position: AVAudioFramePosition = 0
    var peak = 0.0
    var sumSquares = 0.0
    var nanCount: UInt64 = 0

    while position < options.totalFrames {
        let count = AVAudioFrameCount(min(AVAudioFramePosition(options.blockSize),
                                          options.totalFrames - position))
        while eventIndex < events.count && events[eventIndex].frame < position + AVAudioFramePosition(count) {
            let event = events[eventIndex]
            eventIndex += 1
            let offset = event.frame - position
            switch event.kind {
            case 1:
                let note = UInt8(clamping: Int(event.a.rounded()))
                let velocity = UInt8(clamping: Int((event.b * 127.0).rounded()))
                noteByID[event.id] = note
                let bytes = [UInt8(0x90), note, velocity]
                bytes.withUnsafeBufferPointer {
                    scheduleMIDI(AUEventSampleTimeImmediate + AUEventSampleTime(offset), 0,
                                 bytes.count, $0.baseAddress!)
                }
            case 2:
                guard let note = noteByID[event.id] else {
                    warn("noteId \(event.id) の NOTE_ON がないため NOTE_OFF を読み飛ばす")
                    continue
                }
                let bytes = [UInt8(0x80), note, UInt8(0)]
                bytes.withUnsafeBufferPointer {
                    scheduleMIDI(AUEventSampleTimeImmediate + AUEventSampleTime(offset), 0,
                                 bytes.count, $0.baseAddress!)
                }
                noteByID.removeValue(forKey: event.id)
            case 3, 4:
                warn("kind \(event.kind) は M0d 対象外のため読み飛ばす")
            default:
                warn("未知の event kind \(event.kind) を読み飛ばす")
            }
        }

        let status = try engine.renderOffline(count, to: buffer)
        guard status == .success else {
            throw RenderError.message("offline render が失敗した (status=\(status.rawValue), frame=\(position))")
        }
        guard let channels = buffer.floatChannelData else {
            throw RenderError.message("float32 出力バッファを取得できない")
        }
        for channel in 0..<Int(buffer.format.channelCount) {
            for frame in 0..<Int(buffer.frameLength) {
                let sample = Double(channels[channel][frame])
                if sample.isFinite {
                    peak = max(peak, abs(sample))
                    sumSquares += sample * sample
                } else {
                    nanCount += 1
                }
            }
        }
        try outputFile.write(from: buffer)
        position += AVAudioFramePosition(count)
    }

    let sampleCount = Double(options.totalFrames) * Double(format.channelCount)
    let rms = sqrt(sumSquares / sampleCount)
    print(String(format: "peak_dbfs=%.6f rms_dbfs=%.6f nan_count=%llu",
                 db(peak), db(rms), nanCount))
    return nanCount == 0 ? 0 : 1
}

private func fourCC(_ text: String) -> OSType {
    text.utf8.reduce(0) { ($0 << 8) | OSType($1) }
}

guard let options = parseOptions() else {
    usage(CommandLine.arguments[0])
    exit(2)
}

do {
    exit(try run(options))
} catch {
    FileHandle.standardError.write(Data("error: \(error)\n".utf8))
    exit(1)
}
