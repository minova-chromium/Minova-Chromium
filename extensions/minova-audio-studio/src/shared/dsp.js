const TWO_PI = Math.PI * 2;

export function dbToGain(decibels) {
  return 10 ** (Number(decibels || 0) / 20);
}

function complexMagnitude(real, imaginary) {
  return Math.sqrt(real * real + imaginary * imaginary);
}

/**
 * Evaluates a Chromium/Web Audio peaking biquad using Robert Bristow-Johnson's
 * Audio EQ Cookbook coefficients. The result is the band's magnitude in dB.
 */
export function peakingMagnitudeDb({
  sampleRate,
  centerFrequencyHz,
  q,
  gainDb,
  evaluationFrequencyHz
}) {
  const nyquist = sampleRate / 2;
  const center = Math.min(nyquist * 0.999, Math.max(1, centerFrequencyHz));
  const evaluation = Math.min(nyquist * 0.999, Math.max(1, evaluationFrequencyHz));
  const quality = Math.max(0.0001, q);
  const amplitude = 10 ** (gainDb / 40);
  const omega0 = TWO_PI * center / sampleRate;
  const alpha = Math.sin(omega0) / (2 * quality);
  const cosine0 = Math.cos(omega0);

  const b0 = 1 + alpha * amplitude;
  const b1 = -2 * cosine0;
  const b2 = 1 - alpha * amplitude;
  const a0 = 1 + alpha / amplitude;
  const a1 = -2 * cosine0;
  const a2 = 1 - alpha / amplitude;

  const omega = TWO_PI * evaluation / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const cosine2 = Math.cos(omega * 2);
  const sine2 = Math.sin(omega * 2);
  const numeratorReal = b0 + b1 * cosine + b2 * cosine2;
  const numeratorImaginary = -b1 * sine - b2 * sine2;
  const denominatorReal = a0 + a1 * cosine + a2 * cosine2;
  const denominatorImaginary = -a1 * sine - a2 * sine2;
  const numerator = complexMagnitude(numeratorReal, numeratorImaginary);
  const denominator = Math.max(Number.EPSILON, complexMagnitude(
    denominatorReal,
    denominatorImaginary
  ));
  return 20 * Math.log10(Math.max(Number.EPSILON, numerator / denominator));
}

/**
 * Finds the maximum combined EQ boost on a logarithmic frequency grid. The
 * returned preamp value offsets only positive peaks, so a flat EQ remains at
 * exact unity gain while boosted curves receive enough digital headroom.
 */
export function calculateEqHeadroom(equalizer, sampleRate = 48000, pointCount = 768) {
  if (!equalizer?.enabled || !Array.isArray(equalizer.bands)) {
    return { maxBoostDb: 0, preampDb: 0 };
  }

  const minimumFrequency = 20;
  const maximumFrequency = Math.min(20000, sampleRate / 2 * 0.999);
  const points = Math.max(64, Math.floor(pointCount));
  let maxBoostDb = 0;

  for (let index = 0; index < points; index += 1) {
    const progress = index / (points - 1);
    const frequency = minimumFrequency
      * (maximumFrequency / minimumFrequency) ** progress;
    let combinedDb = 0;
    for (const band of equalizer.bands) {
      combinedDb += peakingMagnitudeDb({
        sampleRate,
        centerFrequencyHz: band.frequencyHz,
        q: band.q,
        gainDb: band.gainDb,
        evaluationFrequencyHz: frequency
      });
    }
    maxBoostDb = Math.max(maxBoostDb, combinedDb);
  }

  const roundedBoost = Math.max(0, Math.round(maxBoostDb * 100) / 100);
  const safetyMarginDb = Math.max(0, Number(equalizer.safetyMarginDb) || 0);
  return {
    maxBoostDb: roundedBoost,
    preampDb: roundedBoost > 0 && equalizer.autoHeadroom
      ? -(roundedBoost + safetyMarginDb)
      : 0
  };
}
