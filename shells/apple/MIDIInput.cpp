#include <CoreMIDI/CoreMIDI.h>

#include <cstddef>
#include <cstdint>

extern "C" {

typedef void (*SynthMIDICallback)(void* context, uint8_t status, uint8_t data1, uint8_t data2);

}

namespace {

struct MIDIBridge {
    MIDIClientRef client = 0;
    MIDIPortRef port = 0;
    SynthMIDICallback callback = nullptr;
    void* callbackContext = nullptr;
    uint8_t runningStatus = 0;
};

MIDIBridge gBridge;

size_t messageLength(uint8_t status) {
    const uint8_t kind = status & 0xF0u;
    if (kind == 0xC0u || kind == 0xD0u) return 2;
    if (kind >= 0x80u && kind <= 0xE0u) return 3;
    return 0;
}

void parseBytes(const uint8_t* bytes, size_t length) {
    size_t index = 0;
    while (index < length) {
        const uint8_t byte = bytes[index];
        if (byte >= 0xF8u) {
            ++index;
            continue;
        }
        uint8_t status = gBridge.runningStatus;
        if ((byte & 0x80u) != 0u) {
            status = byte;
            ++index;
            if (status >= 0xF0u) {
                gBridge.runningStatus = 0;
                continue;
            }
            gBridge.runningStatus = status;
        }
        const size_t bytesInMessage = messageLength(status);
        if (bytesInMessage == 0 || index + bytesInMessage - 1 > length) break;
        const uint8_t data1 = bytes[index];
        const uint8_t data2 = bytesInMessage == 3 ? bytes[index + 1] : 0;
        index += bytesInMessage - 1;
        if (gBridge.callback != nullptr) {
            gBridge.callback(gBridge.callbackContext, status, data1, data2);
        }
    }
}

void midiRead(const MIDIPacketList* packetList, void*, void*) {
    const MIDIPacket* packet = &packetList->packet[0];
    for (UInt32 index = 0; index < packetList->numPackets; ++index) {
        parseBytes(packet->data, packet->length);
        packet = MIDIPacketNext(packet);
    }
}

}  // namespace

extern "C" int32_t synth_midi_start(SynthMIDICallback callback, void* context) {
    if (gBridge.client != 0) return static_cast<int32_t>(MIDIGetNumberOfSources());
    gBridge.callback = callback;
    gBridge.callbackContext = context;
    gBridge.runningStatus = 0;

    OSStatus status = MIDIClientCreate(CFSTR("SynthEngine MIDI"), nullptr, nullptr, &gBridge.client);
    if (status != noErr) return -static_cast<int32_t>(status == 0 ? 1 : status);
    status = MIDIInputPortCreate(gBridge.client, CFSTR("SynthEngine Input"), midiRead, nullptr,
                                 &gBridge.port);
    if (status != noErr) {
        MIDIClientDispose(gBridge.client);
        gBridge.client = 0;
        return -static_cast<int32_t>(status == 0 ? 1 : status);
    }

    const ItemCount sourceCount = MIDIGetNumberOfSources();
    int32_t connected = 0;
    for (ItemCount index = 0; index < sourceCount; ++index) {
        MIDIEndpointRef source = MIDIGetSource(index);
        if (source != 0 && MIDIPortConnectSource(gBridge.port, source, nullptr) == noErr) ++connected;
    }
    return connected;
}

extern "C" void synth_midi_stop(void) {
    if (gBridge.port != 0) MIDIPortDispose(gBridge.port);
    if (gBridge.client != 0) MIDIClientDispose(gBridge.client);
    gBridge = MIDIBridge{};
}
