#include "synth_engine.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

struct AbsoluteEvent {
    uint64_t frame;
    uint32_t kind;
    uint32_t id;
    float a;
    float b;
};

struct Options {
    const char* preset = nullptr;
    const char* events = nullptr;
    const char* output = nullptr;
    const char* sendOutput = nullptr;
    uint32_t sampleRate = 48000;
    uint32_t block = 128;
    uint64_t frames = 0;
};

static void usage(const char* program) {
    std::fprintf(stderr,
        "usage: %s --preset FILE --events FILE --out FILE [--send-out FILE] "
        "--sr HZ --block N --frames N\n",
        program);
}

static bool parse_options(int argc, char** argv, Options& options) {
    for (int i = 1; i < argc; ++i) {
        if (i + 1 >= argc) return false;
        const char* key = argv[i++];
        const char* value = argv[i];
        if (std::strcmp(key, "--preset") == 0) options.preset = value;
        else if (std::strcmp(key, "--events") == 0) options.events = value;
        else if (std::strcmp(key, "--out") == 0) options.output = value;
        else if (std::strcmp(key, "--send-out") == 0) options.sendOutput = value;
        else if (std::strcmp(key, "--sr") == 0)
            options.sampleRate = static_cast<uint32_t>(std::strtoul(value, nullptr, 10));
        else if (std::strcmp(key, "--block") == 0)
            options.block = static_cast<uint32_t>(std::strtoul(value, nullptr, 10));
        else if (std::strcmp(key, "--frames") == 0)
            options.frames = std::strtoull(value, nullptr, 10);
        else return false;
    }
    return options.preset != nullptr && options.events != nullptr && options.output != nullptr &&
           options.sampleRate != 0 && options.block != 0 && options.frames != 0;
}

static bool load_preset(const char* path, SynthEngine* engine) {
    std::FILE* file = std::fopen(path, "r");
    if (file == nullptr) return false;
    char line[256];
    bool ok = true;
    while (std::fgets(line, sizeof(line), file) != nullptr) {
        char* comment = std::strchr(line, '#');
        if (comment != nullptr) *comment = '\0';
        uint32_t id = 0;
        float value = 0.0f;
        char extra = '\0';
        const int fields = std::sscanf(line, " %u = %f %c", &id, &value, &extra);
        if (fields == EOF || fields == 0) continue;
        if (fields != 2 || synth_set_param(engine, id, value) != 0) {
            ok = false;
            break;
        }
    }
    std::fclose(file);
    return ok;
}

static bool load_events(const char* path, std::vector<AbsoluteEvent>& events) {
    std::FILE* file = std::fopen(path, "r");
    if (file == nullptr) return false;
    char line[256];
    bool ok = true;
    while (std::fgets(line, sizeof(line), file) != nullptr) {
        char* comment = std::strchr(line, '#');
        if (comment != nullptr) *comment = '\0';
        AbsoluteEvent event{};
        unsigned long long frame = 0;
        char extra = '\0';
        const int fields = std::sscanf(line, " %llu %u %u %f %f %c",
            &frame, &event.kind, &event.id, &event.a, &event.b, &extra);
        if (fields == EOF || fields == 0) continue;
        if (fields != 5) {
            ok = false;
            break;
        }
        event.frame = static_cast<uint64_t>(frame);
        events.push_back(event);
    }
    std::fclose(file);
    return ok;
}

static void write_u16(std::FILE* file, uint16_t value) {
    const unsigned char bytes[2] = {
        static_cast<unsigned char>(value),
        static_cast<unsigned char>(value >> 8)
    };
    (void)std::fwrite(bytes, 1, sizeof(bytes), file);
}

static void write_u32(std::FILE* file, uint32_t value) {
    const unsigned char bytes[4] = {
        static_cast<unsigned char>(value),
        static_cast<unsigned char>(value >> 8),
        static_cast<unsigned char>(value >> 16),
        static_cast<unsigned char>(value >> 24)
    };
    (void)std::fwrite(bytes, 1, sizeof(bytes), file);
}

static bool write_wav(const char* path, const std::vector<float>& left,
                      const std::vector<float>& right, uint32_t sampleRate) {
    if (left.size() != right.size() || left.size() > 0x1fffffffu) return false;
    std::FILE* file = std::fopen(path, "wb");
    if (file == nullptr) return false;
    const uint32_t dataBytes = static_cast<uint32_t>(left.size() * 2u * sizeof(float));
    (void)std::fwrite("RIFF", 1, 4, file);
    write_u32(file, 36u + dataBytes);
    (void)std::fwrite("WAVEfmt ", 1, 8, file);
    write_u32(file, 16);
    write_u16(file, 3);
    write_u16(file, 2);
    write_u32(file, sampleRate);
    write_u32(file, sampleRate * 2u * static_cast<uint32_t>(sizeof(float)));
    write_u16(file, static_cast<uint16_t>(2u * sizeof(float)));
    write_u16(file, 32);
    (void)std::fwrite("data", 1, 4, file);
    write_u32(file, dataBytes);
    for (size_t i = 0; i < left.size(); ++i) {
        uint32_t bits = 0;
        std::memcpy(&bits, &left[i], sizeof(bits));
        write_u32(file, bits);
        std::memcpy(&bits, &right[i], sizeof(bits));
        write_u32(file, bits);
    }
    const bool ok = std::ferror(file) == 0 && std::fclose(file) == 0;
    return ok;
}

int main(int argc, char** argv) {
    Options options;
    if (!parse_options(argc, argv, options)) {
        usage(argv[0]);
        return 2;
    }
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), options.sampleRate, options.block);
    if (engine == nullptr || !load_preset(options.preset, engine)) {
        std::fprintf(stderr, "error: could not create engine or parse preset\n");
        return 1;
    }
    std::vector<AbsoluteEvent> allEvents;
    if (!load_events(options.events, allEvents)) {
        std::fprintf(stderr, "error: could not parse events\n");
        return 1;
    }
    std::vector<float> left(options.frames);
    std::vector<float> right(options.frames);
    const bool renderSend = options.sendOutput != nullptr;
    std::vector<float> sendLeft(renderSend ? options.frames : 0);
    std::vector<float> sendRight(renderSend ? options.frames : 0);
    std::vector<SynthEvent> blockEvents;
    uint64_t position = 0;
    while (position < options.frames) {
        const uint32_t count = static_cast<uint32_t>(
            options.frames - position < options.block ? options.frames - position : options.block);
        blockEvents.clear();
        for (const AbsoluteEvent& absolute : allEvents) {
            if (absolute.frame >= position && absolute.frame < position + count) {
                blockEvents.push_back(SynthEvent{
                    static_cast<uint32_t>(absolute.frame - position), absolute.kind, absolute.id,
                    absolute.a, absolute.b
                });
            }
        }
        const int result = renderSend
            ? synth_process_send(engine,
                blockEvents.empty() ? nullptr : blockEvents.data(),
                static_cast<uint32_t>(blockEvents.size()), left.data() + position,
                right.data() + position, sendLeft.data() + position,
                sendRight.data() + position, count)
            : synth_process(engine,
                blockEvents.empty() ? nullptr : blockEvents.data(),
                static_cast<uint32_t>(blockEvents.size()), left.data() + position,
                right.data() + position, count);
        if (result != 0) {
            std::fprintf(stderr, "error: %s returned %d\n",
                renderSend ? "synth_process_send" : "synth_process", result);
            return 1;
        }
        position += count;
    }
    uint64_t nanCount = 0;
    double peak = 0.0;
    double sumSquares = 0.0;
    for (float sample : left) {
        if (!std::isfinite(sample)) {
            ++nanCount;
            continue;
        }
        const double magnitude = std::fabs(static_cast<double>(sample));
        if (magnitude > peak) peak = magnitude;
        sumSquares += static_cast<double>(sample) * static_cast<double>(sample);
    }
    if (!write_wav(options.output, left, right, options.sampleRate)) {
        std::fprintf(stderr, "error: could not write WAV\n");
        return 1;
    }
    if (renderSend && !write_wav(options.sendOutput, sendLeft, sendRight, options.sampleRate)) {
        std::fprintf(stderr, "error: could not write send WAV\n");
        return 1;
    }
    const double rms = std::sqrt(sumSquares / static_cast<double>(left.size()));
    const double peakDb = peak > 0.0 ? 20.0 * std::log10(peak) : -INFINITY;
    const double rmsDb = rms > 0.0 ? 20.0 * std::log10(rms) : -INFINITY;
    std::printf("peak_dbfs=%.6f rms_dbfs=%.6f nan_count=%llu\n",
                peakDb, rmsDb, static_cast<unsigned long long>(nanCount));
    return nanCount == 0 ? 0 : 1;
}
