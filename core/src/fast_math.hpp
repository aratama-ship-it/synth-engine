#ifndef SYNTH_FAST_MATH_HPP
#define SYNTH_FAST_MATH_HPP

namespace synth {

constexpr double kPi = 3.14159265358979323846264338327950288;
constexpr double kTwoPi = 6.28318530717958647692528676655900576;
constexpr double kHalfPi = 1.57079632679489661923132169163975144;
constexpr double kInvTwoPi = 0.15915494309189533576888376337251436;
constexpr double kLn2 = 0.69314718055994530941723212145817657;

inline double absd(double value) { return value < 0.0 ? -value : value; }

inline double wrap_pi(double value) {
    const long long turns = static_cast<long long>(value * kInvTwoPi);
    value -= static_cast<double>(turns) * kTwoPi;
    if (value > kPi) value -= kTwoPi;
    if (value < -kPi) value += kTwoPi;
    return value;
}

inline double fast_sin(double value) {
    double x = wrap_pi(value);
    if (x > kHalfPi) x = kPi - x;
    else if (x < -kHalfPi) x = -kPi - x;
    const double x2 = x * x;
    const double polynomial = 1.0 + x2 * (-1.0 / 6.0 + x2 * (1.0 / 120.0 +
        x2 * (-1.0 / 5040.0 + x2 * (1.0 / 362880.0 +
        x2 * (-1.0 / 39916800.0)))));
    return x * polynomial;
}

inline double fast_cos(double value) { return fast_sin(value + kHalfPi); }

inline double tan_pi_normalized(double value) {
    const double angle = kPi * value;
    return fast_sin(angle) / fast_cos(angle);
}

inline double exp2_fraction(double x) {
    const double y = x * kLn2;
    return 1.0 + y * (1.0 + y * (1.0 / 2.0 + y * (1.0 / 6.0 +
        y * (1.0 / 24.0 + y * (1.0 / 120.0 + y * (1.0 / 720.0 +
        y * (1.0 / 5040.0 + y * (1.0 / 40320.0))))))));
}

inline double fast_exp2(double value) {
    int whole = static_cast<int>(value);
    if (value < 0.0 && static_cast<double>(whole) != value) --whole;
    const double fraction = value - static_cast<double>(whole);
    double scale = 1.0;
    if (whole >= 0) {
        for (int i = 0; i < whole; ++i) scale *= 2.0;
    } else {
        for (int i = 0; i > whole; --i) scale *= 0.5;
    }
    return scale * exp2_fraction(fraction);
}

inline double exp2_fast(double value) { return fast_exp2(value); }

inline double fast_pow2(double value) { return fast_exp2(value); }

inline double fast_log2(double value) {
    if (value <= 0.0) return -1024.0;
    int exponent = 0;
    while (value >= 2.0) { value *= 0.5; ++exponent; }
    while (value < 1.0) { value *= 2.0; --exponent; }
    const double z = (value - 1.0) / (value + 1.0);
    const double z2 = z * z;
    const double ln = 2.0 * z * (1.0 + z2 * (1.0 / 3.0 + z2 *
        (1.0 / 5.0 + z2 * (1.0 / 7.0 + z2 * (1.0 / 9.0)))));
    return static_cast<double>(exponent) + ln / kLn2;
}

inline float clampf(float value, float low, float high) {
    return value < low ? low : (value > high ? high : value);
}

}  // namespace synth

#endif
