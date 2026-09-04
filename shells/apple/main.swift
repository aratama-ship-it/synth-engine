import AppKit
import AudioToolbox
import AVFoundation
import CoreMIDI

private typealias MIDICallback = @convention(c) (
    UnsafeMutableRawPointer?, UInt8, UInt8, UInt8
) -> Void

@_silgen_name("synth_midi_start")
private func synthMIDIStart(_ callback: MIDICallback?, _ context: UnsafeMutableRawPointer?) -> Int32

@_silgen_name("synth_midi_stop")
private func synthMIDIStop()

private let componentDescription = AudioComponentDescription(
    componentType: kAudioUnitType_MusicDevice,
    componentSubType: 0x536B656E, // Sken
    componentManufacturer: 0x41726174, // Arat
    componentFlags: 0,
    componentFlagsMask: 0
)

private final class KeyboardSurface: NSView {
    var noteOn: ((UInt8) -> Void)?
    var noteOff: ((UInt8) -> Void)?
    private var pressed = Set<UInt16>()

    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        guard !event.isARepeat,
              let scalar = event.charactersIgnoringModifiers?.lowercased().unicodeScalars.first,
              scalar.value >= 97, scalar.value <= 122 else {
            super.keyDown(with: event)
            return
        }
        let key = UInt16(scalar.value - 97)
        guard pressed.insert(key).inserted else { return }
        noteOn?(UInt8(48 + key))
    }

    override func keyUp(with event: NSEvent) {
        guard let scalar = event.charactersIgnoringModifiers?.lowercased().unicodeScalars.first,
              scalar.value >= 97, scalar.value <= 122 else {
            super.keyUp(with: event)
            return
        }
        let key = UInt16(scalar.value - 97)
        guard pressed.remove(key) != nil else { return }
        noteOff?(UInt8(48 + key))
    }

    func releaseAll() {
        for key in pressed { noteOff?(UInt8(48 + key)) }
        pressed.removeAll()
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let engine = AVAudioEngine()
    private var instrument: AVAudioUnit?
    private var window: NSWindow?
    private var statusLabel: NSTextField?
    private var formatLabel: NSTextField?
    private var keyboardSurface: KeyboardSurface?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        buildWindow()
        instantiateInstrument()
    }

    func applicationWillTerminate(_ notification: Notification) {
        keyboardSurface?.releaseAll()
        engine.stop()
        synthMIDIStop()
    }

    func windowDidResignKey(_ notification: Notification) {
        keyboardSurface?.releaseAll()
    }

    private func buildWindow() {
        let frame = NSRect(x: 0, y: 0, width: 560, height: 240)
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "SynthEngine"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()

        let root = KeyboardSurface(frame: frame)
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor(
            calibratedRed: 244 / 255, green: 241 / 255, blue: 232 / 255, alpha: 1
        ).cgColor
        root.noteOn = { [weak self] note in self?.sendNote(note, on: true, velocity: 104) }
        root.noteOff = { [weak self] note in self?.sendNote(note, on: false, velocity: 0) }

        let version = label("v0.1.0", size: 12, weight: .medium)
        let title = label("A–Z で演奏", size: 30, weight: .semibold)
        let detail = label("ウインドウを選択し、英字キーを押してください", size: 14, weight: .regular)
        let status = label("AUv3 を準備中…", size: 13, weight: .medium)
        status.textColor = NSColor(calibratedRed: 0.49, green: 0.20, blue: 0.08, alpha: 1)
        let format = label("バッファ — / サンプルレート —", size: 12, weight: .regular)
        format.textColor = NSColor(calibratedWhite: 0.28, alpha: 1)

        for view in [version, title, detail, status, format] {
            root.addSubview(view)
            view.translatesAutoresizingMaskIntoConstraints = false
        }
        NSLayoutConstraint.activate([
            version.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 24),
            version.topAnchor.constraint(equalTo: root.topAnchor, constant: 20),
            title.leadingAnchor.constraint(equalTo: version.leadingAnchor),
            title.topAnchor.constraint(equalTo: version.bottomAnchor, constant: 28),
            detail.leadingAnchor.constraint(equalTo: version.leadingAnchor),
            detail.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
            status.leadingAnchor.constraint(equalTo: version.leadingAnchor),
            status.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -24),
            format.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -24),
            format.centerYAnchor.constraint(equalTo: status.centerYAnchor)
        ])

        window.contentView = root
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(root)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
        self.statusLabel = status
        self.formatLabel = format
        self.keyboardSurface = root
    }

    private func label(_ string: String, size: CGFloat, weight: NSFont.Weight) -> NSTextField {
        let field = NSTextField(labelWithString: string)
        field.font = NSFont.systemFont(ofSize: size, weight: weight)
        field.textColor = NSColor(calibratedWhite: 0.11, alpha: 1)
        field.lineBreakMode = .byTruncatingTail
        return field
    }

    private func instantiateInstrument() {
        AVAudioUnit.instantiate(with: componentDescription, options: [.loadOutOfProcess]) {
            [weak self] audioUnit, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    self.statusLabel?.stringValue = "AUv3 の読込に失敗: \(error.localizedDescription)"
                    NSLog("SynthEngine AUv3 instantiate failed: %@", error.localizedDescription)
                    return
                }
                guard let audioUnit else {
                    self.statusLabel?.stringValue = "AUv3 の読込に失敗"
                    NSLog("SynthEngine AUv3 instantiate returned no unit")
                    return
                }
                self.startAudio(with: audioUnit)
            }
        }
    }

    private func startAudio(with audioUnit: AVAudioUnit) {
        instrument = audioUnit
        engine.attach(audioUnit)
        let outputFormat = engine.outputNode.inputFormat(forBus: 0)
        engine.connect(audioUnit, to: engine.mainMixerNode, format: outputFormat)
        do {
            try engine.start()
            let maximumFrames = audioUnit.auAudioUnit.maximumFramesToRender
            statusLabel?.stringValue = "準備完了 — A〜Z または MIDI 入力"
            formatLabel?.stringValue = "バッファ \(maximumFrames) / \(Int(outputFormat.sampleRate)) Hz"
            let midiSources = synthMIDIStart(midiCallback, Unmanaged.passUnretained(self).toOpaque())
            if midiSources < 0 {
                NSLog("SynthEngine Core MIDI setup failed: %d", midiSources)
            } else {
                NSLog("SynthEngine ready: buffer=%u sampleRate=%.0f MIDI sources=%d",
                      maximumFrames, outputFormat.sampleRate, midiSources)
            }
        } catch {
            statusLabel?.stringValue = "音声出力の開始に失敗: \(error.localizedDescription)"
            NSLog("SynthEngine audio start failed: %@", error.localizedDescription)
        }
    }

    fileprivate func receiveExternalMIDI(status: UInt8, data1: UInt8, data2: UInt8) {
        sendMIDI(status: status, data1: data1, data2: data2)
    }

    private func sendNote(_ note: UInt8, on: Bool, velocity: UInt8) {
        let status: UInt8 = on ? 0x90 : 0x80
        sendMIDI(status: status, data1: note, data2: velocity)
        NSLog("SynthEngine note_%@ note=%u velocity=%u", on ? "on" : "off", note, velocity)
    }

    private func sendMIDI(status: UInt8, data1: UInt8, data2: UInt8) {
        guard let schedule = instrument?.auAudioUnit.scheduleMIDIEventBlock else { return }
        var bytes = [status, data1 & 0x7F, data2 & 0x7F]
        bytes.withUnsafeMutableBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            schedule(AUEventSampleTimeImmediate, 0, 3, base)
        }
    }
}

private let midiCallback: MIDICallback = { context, status, data1, data2 in
    guard let context else { return }
    let delegate = Unmanaged<AppDelegate>.fromOpaque(context).takeUnretainedValue()
    delegate.receiveExternalMIDI(status: status, data1: data1, data2: data2)
}

let application = NSApplication.shared
private let delegate = AppDelegate()
application.delegate = delegate
application.run()
