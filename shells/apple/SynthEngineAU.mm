#import <AudioToolbox/AudioToolbox.h>
#import <AVFAudio/AVFAudio.h>
#import <Foundation/Foundation.h>

#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <cstring>

#include "synth_engine.h"
#include "generated_presets.h"

namespace {

constexpr uint32_t kMaximumEvents = 2048;

struct DeferredEvent {
    SynthEvent event;
    uint64_t framesUntil;
};

struct RenderContext {
    explicit RenderContext(uint32_t count)
        : parameterCount(count),
          parameterValues(new std::atomic<float>[count]),
          dirtyParameters(new std::atomic<bool>[count]) {}

    ~RenderContext() {
        delete[] dirtyParameters;
        delete[] parameterValues;
    }

    SynthEngine* engine = nullptr;
    void* engineMemory = nullptr;
    float* left = nullptr;
    float* right = nullptr;
    float* interleaved = nullptr;
    AUAudioFrameCount maximumFrames = 0;
    uint32_t outputChannels = 2;
    uint32_t parameterCount;
    std::atomic<float>* parameterValues;
    std::atomic<bool>* dirtyParameters;
    std::atomic<uint32_t> droppedEvents{0};
    SynthEvent blockEvents[kMaximumEvents];
    DeferredEvent deferredEvents[kMaximumEvents];
    uint32_t deferredEventCount = 0;
};

AudioUnitParameterUnit parameterUnit(uint32_t flags) {
    if ((flags & SYNTH_PARAM_FLAG_INTEGER) != 0u) return kAudioUnitParameterUnit_Indexed;
    if ((flags & SYNTH_PARAM_FLAG_SECONDS) != 0u) return kAudioUnitParameterUnit_Seconds;
    if ((flags & SYNTH_PARAM_FLAG_HERTZ) != 0u) return kAudioUnitParameterUnit_Hertz;
    if ((flags & SYNTH_PARAM_FLAG_CENTS) != 0u) return kAudioUnitParameterUnit_Cents;
    if ((flags & SYNTH_PARAM_FLAG_SEMITONES) != 0u)
        return kAudioUnitParameterUnit_RelativeSemiTones;
    if ((flags & SYNTH_PARAM_FLAG_OCTAVES) != 0u) return kAudioUnitParameterUnit_Octaves;
    if ((flags & SYNTH_PARAM_FLAG_GAIN) != 0u) return kAudioUnitParameterUnit_LinearGain;
    return kAudioUnitParameterUnit_Generic;
}

AUValue normalizedParameterValue(const SynthParamInfo& parameter, AUValue value) {
    if (value < parameter.minimum) value = parameter.minimum;
    if (value > parameter.maximum) value = parameter.maximum;
    if ((parameter.flags & SYNTH_PARAM_FLAG_INTEGER) != 0u) {
        const int32_t rounded = value >= 0.0f ? static_cast<int32_t>(value + 0.5f)
                                              : static_cast<int32_t>(value - 0.5f);
        value = static_cast<AUValue>(rounded);
    }
    return value;
}

void markAllParametersDirty(RenderContext* context) {
    for (uint32_t address = 0; address < context->parameterCount; ++address)
        context->dirtyParameters[address].store(true, std::memory_order_relaxed);
}

void clearOutput(AudioBufferList* outputData, AUAudioFrameCount frameCount) {
    if (outputData == nullptr) return;
    for (UInt32 index = 0; index < outputData->mNumberBuffers; ++index) {
        AudioBuffer& buffer = outputData->mBuffers[index];
        if (buffer.mData != nullptr) {
            const size_t bytes = static_cast<size_t>(frameCount) *
                                 static_cast<size_t>(buffer.mNumberChannels) * sizeof(float);
            std::memset(buffer.mData, 0, bytes);
            buffer.mDataByteSize = static_cast<UInt32>(bytes);
        }
    }
}

bool appendEvent(RenderContext* context, const SynthEvent& event, uint64_t framesUntil,
                 AUAudioFrameCount frameCount, uint32_t* eventCount) {
    if (framesUntil < frameCount) {
        if (*eventCount >= kMaximumEvents) {
            context->droppedEvents.fetch_add(1, std::memory_order_relaxed);
            return false;
        }
        SynthEvent ready = event;
        ready.offset = static_cast<uint32_t>(framesUntil);
        context->blockEvents[(*eventCount)++] = ready;
        return true;
    }

    if (context->deferredEventCount >= kMaximumEvents) {
        context->droppedEvents.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
    context->deferredEvents[context->deferredEventCount++] = {
        event, framesUntil - static_cast<uint64_t>(frameCount)};
    return true;
}

bool decodeMIDIEvent(const AUMIDIEvent& midi, SynthEvent* event) {
    if (midi.length < 3) return false;
    const uint8_t status = midi.data[0];
    const uint8_t message = status & 0xF0u;
    const uint8_t channel = status & 0x0Fu;
    const uint8_t note = midi.data[1] & 0x7Fu;
    const uint8_t velocity = midi.data[2] & 0x7Fu;
    if (message != 0x80u && message != 0x90u) return false;

    event->offset = 0;
    event->kind = (message == 0x80u || velocity == 0u) ? SYNTH_EV_NOTE_OFF : SYNTH_EV_NOTE_ON;
    event->id = static_cast<uint32_t>(channel) * 128u + static_cast<uint32_t>(note);
    event->a = static_cast<float>(note);
    event->b = static_cast<float>(velocity) / 127.0f;
    return true;
}

uint64_t eventOffset(const AURenderEvent* event, const AudioTimeStamp* timestamp) {
    if (event->head.eventSampleTime == AUEventSampleTimeImmediate || timestamp == nullptr ||
        (timestamp->mFlags & kAudioTimeStampSampleTimeValid) == 0) {
        return 0;
    }
    const AUEventSampleTime delta = event->head.eventSampleTime -
                                    static_cast<AUEventSampleTime>(timestamp->mSampleTime);
    return delta > 0 ? static_cast<uint64_t>(delta) : 0;
}

void applyPendingParameters(RenderContext* context) {
    for (uint32_t address = 0; address < context->parameterCount; ++address) {
        if (context->dirtyParameters[address].exchange(false, std::memory_order_acquire)) {
            (void)synth_set_param(
                context->engine, address,
                context->parameterValues[address].load(std::memory_order_relaxed));
        }
    }
}

AUAudioUnitStatus render(RenderContext* context, AudioUnitRenderActionFlags* actionFlags,
                         const AudioTimeStamp* timestamp, AUAudioFrameCount frameCount,
                         NSInteger outputBusNumber, AudioBufferList* outputData,
                         const AURenderEvent* realtimeEventListHead) {
    (void)actionFlags;
    if (context == nullptr || context->engine == nullptr || outputData == nullptr) {
        clearOutput(outputData, frameCount);
        return kAudioUnitErr_Uninitialized;
    }
    if (outputBusNumber != 0) {
        clearOutput(outputData, frameCount);
        return kAudioUnitErr_InvalidElement;
    }
    if (frameCount > context->maximumFrames) {
        clearOutput(outputData, frameCount);
        return kAudioUnitErr_TooManyFramesToProcess;
    }

    applyPendingParameters(context);

    uint32_t eventCount = 0;
    const uint32_t oldDeferredCount = context->deferredEventCount;
    context->deferredEventCount = 0;
    for (uint32_t index = 0; index < oldDeferredCount; ++index) {
        const DeferredEvent deferred = context->deferredEvents[index];
        (void)appendEvent(context, deferred.event, deferred.framesUntil, frameCount, &eventCount);
    }

    for (const AURenderEvent* current = realtimeEventListHead; current != nullptr;
         current = current->head.next) {
        SynthEvent event{};
        bool accepted = false;
        if (current->head.eventType == AURenderEventMIDI) {
            accepted = decodeMIDIEvent(current->MIDI, &event);
        } else if (current->head.eventType == AURenderEventParameter ||
                   current->head.eventType == AURenderEventParameterRamp) {
            const AUParameterAddress address = current->parameter.parameterAddress;
            if (address < context->parameterCount) {
                event.kind = SYNTH_EV_PARAM;
                event.id = static_cast<uint32_t>(address);
                event.a = current->parameter.value;
                event.b = 0.0f;
                context->parameterValues[address].store(event.a, std::memory_order_relaxed);
                accepted = true;
            }
        }
        if (accepted) {
            (void)appendEvent(context, event, eventOffset(current, timestamp), frameCount,
                              &eventCount);
        }
    }

    const int processResult = synth_process(context->engine, context->blockEvents, eventCount,
                                            context->left, context->right, frameCount);
    if (processResult < 0) {
        clearOutput(outputData, frameCount);
        return kAudioUnitErr_FailedInitialization;
    }

    if (outputData->mNumberBuffers >= 2) {
        AudioBuffer& leftBuffer = outputData->mBuffers[0];
        AudioBuffer& rightBuffer = outputData->mBuffers[1];
        const size_t bytes = static_cast<size_t>(frameCount) * sizeof(float);
        if (leftBuffer.mData == nullptr) leftBuffer.mData = context->left;
        else if (leftBuffer.mData != context->left) std::memcpy(leftBuffer.mData, context->left, bytes);
        if (rightBuffer.mData == nullptr) rightBuffer.mData = context->right;
        else if (rightBuffer.mData != context->right) std::memcpy(rightBuffer.mData, context->right, bytes);
        leftBuffer.mDataByteSize = static_cast<UInt32>(bytes);
        rightBuffer.mDataByteSize = static_cast<UInt32>(bytes);
    } else if (outputData->mNumberBuffers == 1) {
        AudioBuffer& buffer = outputData->mBuffers[0];
        if (buffer.mNumberChannels <= 1 || context->outputChannels <= 1) {
            const size_t bytes = static_cast<size_t>(frameCount) * sizeof(float);
            if (buffer.mData == nullptr) buffer.mData = context->left;
            else if (buffer.mData != context->left) std::memcpy(buffer.mData, context->left, bytes);
            buffer.mDataByteSize = static_cast<UInt32>(bytes);
        } else {
            for (AUAudioFrameCount frame = 0; frame < frameCount; ++frame) {
                context->interleaved[frame * 2u] = context->left[frame];
                context->interleaved[frame * 2u + 1u] = context->right[frame];
            }
            const size_t bytes = static_cast<size_t>(frameCount) * 2u * sizeof(float);
            if (buffer.mData == nullptr) buffer.mData = context->interleaved;
            else std::memcpy(buffer.mData, context->interleaved, bytes);
            buffer.mDataByteSize = static_cast<UInt32>(bytes);
        }
    }
    return noErr;
}

NSError* makeError(NSInteger code, NSString* description) {
    return [NSError errorWithDomain:@"com.pygmix.synthengine.au"
                               code:code
                           userInfo:@{NSLocalizedDescriptionKey: description}];
}

}  // namespace

@interface SynthEngineAudioUnit : AUAudioUnit {
    AUAudioUnitBusArray* _inputBusArray;
    AUAudioUnitBusArray* _outputBusArray;
    NSArray<AUAudioUnitPreset*>* _factoryPresets;
    AUAudioUnitPreset* _currentPreset;
    RenderContext* _renderContext;
}
@end

@implementation SynthEngineAudioUnit

- (instancetype)initWithComponentDescription:(AudioComponentDescription)componentDescription
                                      options:(AudioComponentInstantiationOptions)options
                                        error:(NSError**)outError {
    self = [super initWithComponentDescription:componentDescription options:options error:outError];
    if (self == nil) return nil;

    const uint32_t parameterCount = synth_param_count();
    if (parameterCount == 0) {
        if (outError != nullptr) *outError = makeError(4, @"SynthEngine has no parameters.");
        return nil;
    }
    _renderContext = new RenderContext(parameterCount);
    for (uint32_t address = 0; address < parameterCount; ++address) {
        SynthParamInfo definition{};
        if (synth_param_info(address, &definition) != 0) {
            if (outError != nullptr) *outError = makeError(5, @"Unable to read SynthEngine parameters.");
            return nil;
        }
        _renderContext->parameterValues[address].store(definition.defaultValue,
                                                       std::memory_order_relaxed);
        _renderContext->dirtyParameters[address].store(true, std::memory_order_relaxed);
    }

    AVAudioFormat* format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:44100.0
                                                                           channels:2];
    AUAudioUnitBus* outputBus = [[AUAudioUnitBus alloc] initWithFormat:format error:outError];
    if (outputBus == nil) return nil;
    _inputBusArray = [[AUAudioUnitBusArray alloc] initWithAudioUnit:self
                                                            busType:AUAudioUnitBusTypeInput];
    _outputBusArray = [[AUAudioUnitBusArray alloc] initWithAudioUnit:self
                                                             busType:AUAudioUnitBusTypeOutput
                                                              busses:@[outputBus]];
    self.maximumFramesToRender = 4096;

    NSMutableArray<AUParameter*>* parameters = [NSMutableArray array];
    for (uint32_t address = 0; address < parameterCount; ++address) {
        SynthParamInfo definition{};
        if (synth_param_info(address, &definition) != 0) return nil;
        AudioUnitParameterOptions flags = kAudioUnitParameterFlag_IsReadable |
                                          kAudioUnitParameterFlag_IsWritable;
        if (definition.id == 8) flags |= kAudioUnitParameterFlag_ValuesHaveStrings;
        AUParameter* parameter = [AUParameterTree
            createParameterWithIdentifier:[NSString stringWithUTF8String:definition.identifier]
                                      name:[NSString stringWithUTF8String:definition.displayName]
                                   address:definition.id
                                       min:definition.minimum
                                       max:definition.maximum
                                      unit:parameterUnit(definition.flags)
                                  unitName:nil
                                     flags:flags
                              valueStrings:nil
                       dependentParameters:nil];
        parameter.value = definition.defaultValue;
        [parameters addObject:parameter];
    }
    AUParameterTree* tree = [AUParameterTree createTreeWithChildren:parameters];
    RenderContext* context = _renderContext;
    tree.implementorValueObserver = ^(AUParameter* parameter, AUValue value) {
        const AUParameterAddress address = parameter.address;
        if (address < context->parameterCount) {
            context->parameterValues[address].store(value, std::memory_order_relaxed);
            context->dirtyParameters[address].store(true, std::memory_order_release);
        }
    };
    tree.implementorValueProvider = ^AUValue(AUParameter* parameter) {
        const AUParameterAddress address = parameter.address;
        if (address >= context->parameterCount) return 0.0f;
        return context->parameterValues[address].load(std::memory_order_relaxed);
    };
    self.parameterTree = tree;

    NSMutableArray<AUAudioUnitPreset*>* factoryPresets = [NSMutableArray array];
    for (uint32_t index = 0; index < kGeneratedPresetCount; ++index) {
        AUAudioUnitPreset* preset = [[AUAudioUnitPreset alloc] init];
        preset.number = static_cast<NSInteger>(index);
        preset.name = [NSString stringWithUTF8String:kGeneratedPresets[index].name];
        [factoryPresets addObject:preset];
    }
    _factoryPresets = [factoryPresets copy];
    _currentPreset = _factoryPresets.firstObject;
    return self;
}

- (void)dealloc {
    [self deallocateRenderResources];
    delete _renderContext;
}

- (AUAudioUnitBusArray*)inputBusses { return _inputBusArray; }
- (AUAudioUnitBusArray*)outputBusses { return _outputBusArray; }
- (NSArray<NSNumber*>*)channelCapabilities { return @[@0, @1, @0, @2]; }

- (NSArray<AUAudioUnitPreset*>*)factoryPresets { return _factoryPresets; }
- (BOOL)supportsUserPresets { return YES; }

- (AUAudioUnitPreset*)currentPreset { return _currentPreset; }

- (void)setCurrentPreset:(AUAudioUnitPreset*)preset {
    if (preset == nil) {
        _currentPreset = nil;
        return;
    }

    if (preset.number < 0) {
        NSDictionary<NSString*, id>* state = [self presetStateFor:preset error:nil];
        if (state != nil) self.fullState = state;
        _currentPreset = preset;
        return;
    }

    if (preset.number >= static_cast<NSInteger>(kGeneratedPresetCount)) return;
    for (uint32_t address = 0; address < _renderContext->parameterCount; ++address) {
        SynthParamInfo definition{};
        if (synth_param_info(address, &definition) != 0) return;
        _renderContext->parameterValues[address].store(definition.defaultValue,
                                                       std::memory_order_relaxed);
        _renderContext->dirtyParameters[address].store(true, std::memory_order_release);
        self.parameterTree.allParameters[address].value = definition.defaultValue;
    }
    const SynthGeneratedPresetDefinition& generated = kGeneratedPresets[preset.number];
    for (uint32_t index = 0; index < generated.valueCount; ++index) {
        const SynthGeneratedPresetValue& setting = generated.values[index];
        if (setting.id >= _renderContext->parameterCount) continue;
        SynthParamInfo definition{};
        if (synth_param_info(setting.id, &definition) != 0) continue;
        const AUValue value = normalizedParameterValue(definition, setting.value);
        _renderContext->parameterValues[setting.id].store(value, std::memory_order_relaxed);
        _renderContext->dirtyParameters[setting.id].store(true, std::memory_order_release);
        self.parameterTree.allParameters[setting.id].value = value;
    }
    _currentPreset = _factoryPresets[static_cast<NSUInteger>(preset.number)];
}

- (NSTimeInterval)tailTime {
    return static_cast<NSTimeInterval>(
        _renderContext->parameterValues[6].load(std::memory_order_relaxed));
}

- (BOOL)allocateRenderResourcesAndReturnError:(NSError**)outError {
    if (![super allocateRenderResourcesAndReturnError:outError]) return NO;

    const AVAudioFormat* format = _outputBusArray[0].format;
    const AudioStreamBasicDescription* stream = format.streamDescription;
    const bool supported = stream != nullptr && stream->mFormatID == kAudioFormatLinearPCM &&
                           (stream->mFormatFlags & kAudioFormatFlagIsFloat) != 0u &&
                           stream->mBitsPerChannel == 32u && stream->mChannelsPerFrame >= 1u &&
                           stream->mChannelsPerFrame <= 2u;
    if (!supported) {
        [super deallocateRenderResources];
        if (outError != nullptr) *outError = makeError(1, @"Only mono/stereo 32-bit float output is supported.");
        return NO;
    }

    RenderContext* context = _renderContext;
    context->maximumFrames = self.maximumFramesToRender;
    context->outputChannels = stream->mChannelsPerFrame;
    context->engineMemory = std::calloc(1, synth_state_size());
    context->left = static_cast<float*>(std::calloc(context->maximumFrames, sizeof(float)));
    context->right = static_cast<float*>(std::calloc(context->maximumFrames, sizeof(float)));
    context->interleaved = static_cast<float*>(
        std::calloc(static_cast<size_t>(context->maximumFrames) * 2u, sizeof(float)));
    if (context->engineMemory == nullptr || context->left == nullptr || context->right == nullptr ||
        context->interleaved == nullptr) {
        [self deallocateRenderResources];
        if (outError != nullptr) *outError = makeError(2, @"Unable to allocate render resources.");
        return NO;
    }

    context->engine = synth_create(context->engineMemory, synth_state_size(), format.sampleRate,
                                   context->maximumFrames);
    if (context->engine == nullptr) {
        [self deallocateRenderResources];
        if (outError != nullptr) *outError = makeError(3, @"Unable to initialize SynthEngine DSP state.");
        return NO;
    }
    context->deferredEventCount = 0;
    markAllParametersDirty(context);
    applyPendingParameters(context);
    return YES;
}

- (void)deallocateRenderResources {
    RenderContext* context = _renderContext;
    if (context != nullptr) {
        context->engine = nullptr;
        std::free(context->interleaved);
        std::free(context->right);
        std::free(context->left);
        std::free(context->engineMemory);
        context->interleaved = nullptr;
        context->right = nullptr;
        context->left = nullptr;
        context->engineMemory = nullptr;
        context->maximumFrames = 0;
        context->deferredEventCount = 0;
    }
    if (self.renderResourcesAllocated) [super deallocateRenderResources];
}

- (void)reset {
    if (_renderContext->engine != nullptr) synth_reset(_renderContext->engine, SYNTH_RESET_VOICES, 0);
    _renderContext->deferredEventCount = 0;
    [super reset];
}

- (AUInternalRenderBlock)internalRenderBlock {
    RenderContext* context = _renderContext;
    return ^AUAudioUnitStatus(AudioUnitRenderActionFlags* actionFlags,
                              const AudioTimeStamp* timestamp,
                              AUAudioFrameCount frameCount,
                              NSInteger outputBusNumber,
                              AudioBufferList* outputData,
                              const AURenderEvent* realtimeEventListHead,
                              AURenderPullInputBlock pullInputBlock) {
        (void)pullInputBlock;
        return render(context, actionFlags, timestamp, frameCount, outputBusNumber, outputData,
                      realtimeEventListHead);
    };
}

- (NSDictionary<NSString*, id>*)fullState {
    NSMutableDictionary<NSString*, NSNumber*>* parameters = [NSMutableDictionary dictionary];
    for (uint32_t address = 0; address < _renderContext->parameterCount; ++address) {
        SynthParamInfo definition{};
        if (synth_param_info(address, &definition) != 0) continue;
        NSString* identifier = [NSString stringWithUTF8String:definition.identifier];
        parameters[identifier] = @(
            _renderContext->parameterValues[address].load(std::memory_order_relaxed));
    }
    // auval「Class Data does not have required field:<type> == componentType」対策（2026-09-04 実測。Claude 修正）:
    // AUv3 の fullState は super の辞書（type/subtype/manufacturer/version 等の必須キー）を土台にして自前のキーを足す。
    NSMutableDictionary<NSString*, id>* state = [([super fullState] ?: @{}) mutableCopy];
    state[@"stateVersion"] = @2;
    state[@"parameters"] = parameters;
    return state;
}

- (void)setFullState:(NSDictionary<NSString*, id>*)state {
    [super setFullState:state];
    NSDictionary* parameters = [state[@"parameters"] isKindOfClass:[NSDictionary class]]
        ? state[@"parameters"] : nil;
    if (parameters == nil) return;
    for (uint32_t address = 0; address < _renderContext->parameterCount; ++address) {
        SynthParamInfo definition{};
        if (synth_param_info(address, &definition) != 0) continue;
        NSString* identifier = [NSString stringWithUTF8String:definition.identifier];
        NSString* legacyIdentifier = [NSString stringWithFormat:@"%u", address];
        id storedValue = parameters[identifier];
        if (![storedValue isKindOfClass:[NSNumber class]]) storedValue = parameters[legacyIdentifier];
        NSNumber* number = [storedValue isKindOfClass:[NSNumber class]] ? storedValue : nil;
        if (number == nil) continue;
        const AUValue value = normalizedParameterValue(definition, number.floatValue);
        _renderContext->parameterValues[address].store(value, std::memory_order_relaxed);
        _renderContext->dirtyParameters[address].store(true, std::memory_order_release);
        self.parameterTree.allParameters[address].value = value;
    }
}

- (NSDictionary<NSString*, id>*)fullStateForDocument { return self.fullState; }
- (void)setFullStateForDocument:(NSDictionary<NSString*, id>*)state { self.fullState = state; }

@end

@interface SynthEngineAUFactory : NSObject <AUAudioUnitFactory>
@end

@implementation SynthEngineAUFactory
- (void)beginRequestWithExtensionContext:(NSExtensionContext*)context {
    (void)context;
}

- (AUAudioUnit*)createAudioUnitWithComponentDescription:(AudioComponentDescription)description
                                                   error:(NSError**)error {
    return [[SynthEngineAudioUnit alloc] initWithComponentDescription:description options:0 error:error];
}
@end
