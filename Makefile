CXX ?= clang++
ifeq ($(origin CXX), default)
CXX := clang++
endif

CPPFLAGS := -Icore/include -Icore/src
CXXFLAGS := -std=c++20 -O2 -Wall -Wextra -Werror
CORE_FLAGS := -fno-exceptions -fno-rtti
FREESTANDING_FLAGS := $(CORE_FLAGS) -ffreestanding -fno-stack-protector -nostdinc++
CORE_SOURCES := core/src/engine.cpp core/src/wavetable.cpp
CORE_OBJECTS := build/core/engine.o build/core/wavetable.o

.PHONY: all core cli test core-freestanding-check wasm

all: core cli

core: build/libsynth_engine.a

cli: build/render-cli

test: build/tests
	./build/tests

build/libsynth_engine.a: $(CORE_OBJECTS)
	@mkdir -p build
	ar rcs $@ $(CORE_OBJECTS)

build/core/engine.o: core/src/engine.cpp core/src/engine.hpp core/src/params.hpp core/src/fast_math.hpp core/src/wavetable.hpp core/include/synth_engine.h
	@mkdir -p build/core
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(CORE_FLAGS) -c $< -o $@

build/core/wavetable.o: core/src/wavetable.cpp core/src/wavetable.hpp core/src/fast_math.hpp
	@mkdir -p build/core
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(CORE_FLAGS) -c $< -o $@

build/render-cli: $(CORE_SOURCES) tools/render-cli/main.cpp core/include/synth_engine.h core/src/params.hpp
	@mkdir -p build
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(CORE_FLAGS) $(CORE_SOURCES) tools/render-cli/main.cpp -o $@

build/tests: $(CORE_SOURCES) tests/test_main.cpp core/include/synth_engine.h core/src/engine.hpp core/src/params.hpp core/src/fast_math.hpp core/src/rng.hpp
	@mkdir -p build
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(CORE_FLAGS) $(CORE_SOURCES) tests/test_main.cpp -o $@

core-freestanding-check:
	@mkdir -p build/freestanding
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(FREESTANDING_FLAGS) -c core/src/engine.cpp -o build/freestanding/engine.o
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(FREESTANDING_FLAGS) -c core/src/wavetable.cpp -o build/freestanding/wavetable.o
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(FREESTANDING_FLAGS) -c core/src/freestanding_support.cpp -o build/freestanding/freestanding_support.o
	@echo "core-freestanding-check: PASS"

wasm:
	@mkdir -p build
	@if [ -z "$(WASM_CLANG)" ]; then \
		echo "make wasm: skip (WASM_CLANG is not set)"; \
	else \
		"$(WASM_CLANG)" -x c++ $(CPPFLAGS) -std=c++20 -O2 $(FREESTANDING_FLAGS) \
			--target=wasm32 -nostdlib -Wl,--no-entry -Wl,--export-all \
			$(CORE_SOURCES) core/src/freestanding_support.cpp -o build/synth_engine.wasm; \
	fi
