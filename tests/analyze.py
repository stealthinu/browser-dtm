#!/usr/bin/env python3
"""Offline, CPU-only acceptance measurements: ffmpeg + NumPy/SciPy, no pitch correction."""
import json
import os
import subprocess
from pathlib import Path
import numpy as np
from scipy import signal

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'out'
SOURCE = Path(os.environ.get('VOCALOID_SAMPLE', '/workspace/vocaloid-filter-demo/source/vocatab-codex-vocal.wav'))
DEMO = Path(os.environ.get('VOCALOID_DEMO_DIR', '/workspace/vocaloid-filter-demo/v2'))
SR = 44100


def decode(path):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], check=True, capture_output=True)
    return np.frombuffer(result.stdout, dtype='<f4').astype(np.float64)


def align(reference, samples):
    # LAME JS has encoder delay and no gapless tag. Measure it, never assume it is zero.
    corr = signal.correlate(samples, reference, mode='full', method='fft')
    lags = signal.correlation_lags(len(samples), len(reference))
    allowed = np.abs(lags) <= 4096
    lag = int(lags[allowed][np.argmax(corr[allowed])])
    start = max(0, lag)
    aligned = samples[start:start + len(reference)]
    if lag < 0:
        aligned = np.pad(aligned, (-lag, 0))[:len(reference)]
    return np.pad(aligned, (0, max(0, len(reference) - len(aligned)))), lag


def window_rms(samples):
    n = round(SR * 0.02)
    blocks = samples[:len(samples) // n * n].reshape(-1, n)
    return np.sqrt(np.mean(blocks ** 2, axis=1))


def pitch_track(samples):
    # YIN-style difference / cumulative mean normalized difference, 70..700Hz.
    # Absolute frame times are shared by original and all aligned outputs.
    rate = 22050
    # Common preprocessing isolates F0 from the effect's moving upper formants.
    # Fixed for every input; changes no processing output and uses no reference pitch.
    filtered = signal.sosfiltfilt(signal.butter(4, 1200, fs=SR, output='sos'), samples)
    data = signal.resample_poly(filtered, 1, 2)
    frame, hop = 2048, 440
    lo, hi = int(rate / 700), int(rate / 70)
    f0, confidence = [], []
    for start in range(0, len(data) - frame + 1, hop):
        x = data[start:start + frame].copy()
        x -= np.mean(x)
        if np.sqrt(np.mean(x * x)) < 10 ** (-45 / 20):
            f0.append(np.nan); confidence.append(0); continue
        # Fixed comparison length at every lag avoids bias toward longer lags.
        base = x[:frame - hi]
        diff = np.array([np.sum((base - x[t:t + len(base)]) ** 2) for t in range(hi + 1)])
        cmnd = np.ones(hi + 1)
        cmnd[1:] = diff[1:] * np.arange(1, hi + 1) / np.maximum(np.cumsum(diff[1:]), 1e-20)
        candidates = [t for t in range(lo + 1, hi) if cmnd[t] < 0.18 and cmnd[t] <= cmnd[t - 1] and cmnd[t] < cmnd[t + 1]]
        t = candidates[0] if candidates else lo + int(np.argmin(cmnd[lo:hi]))
        quality = 1 - cmnd[t]
        if quality < 0.75 or t <= lo or t >= hi:
            f0.append(np.nan); confidence.append(float(quality)); continue
        denominator = cmnd[t - 1] - 2 * cmnd[t] + cmnd[t + 1]
        delta = 0.5 * (cmnd[t - 1] - cmnd[t + 1]) / denominator if abs(denominator) > 1e-12 else 0
        f0.append(rate / (t + np.clip(delta, -0.5, 0.5)))
        confidence.append(float(quality))
    return np.asarray(f0), np.asarray(confidence)


original = decode(SOURCE)
original_rms_windows = window_rms(original)
active_windows = original_rms_windows > 10 ** (-40 / 20)
pitch_original, confidence_original = pitch_track(original)
rows, checks = [], []

# Independent analysis grid: source YIN F0, source-observed spectral peaks,
# fixed masks reused for every output. No output-dependent window rejection.
HNR_N, HNR_HOP = 4096, 512
HNR_WINDOW = np.hanning(HNR_N)
HNR_BINS = np.fft.rfftfreq(HNR_N, 1 / SR)
HNR_FRAMES = []
for start in range(0, len(original) - HNR_N, HNR_HOP):
    center_s = (start + HNR_N / 2) / SR
    pos = round((center_s - 1024 / 22050) / (440 / 22050))
    if pos < 1 or pos >= len(pitch_original) - 1:
        continue
    region = pitch_original[pos - 1:pos + 2]
    if not np.all(np.isfinite(region)) or np.ptp(1200 * np.log2(region)) > 40:
        continue
    f0 = pitch_original[pos]
    spectrum = np.abs(np.fft.rfft(original[start:start + HNR_N] * HNR_WINDOW)) ** 2
    harmonic = np.zeros(len(HNR_BINS), dtype=bool)
    noise = (HNR_BINS > 500) & (HNR_BINS < 8000)
    for hz in np.arange(f0, 8000, f0):
        candidates = np.flatnonzero(np.abs(HNR_BINS - hz) < 0.15 * f0)
        if not len(candidates):
            continue
        peak_hz = HNR_BINS[candidates[np.argmax(spectrum[candidates])]]
        harmonic |= np.abs(HNR_BINS - peak_hz) < max(2 * SR / HNR_N, hz * 0.006)
        noise &= np.abs(HNR_BINS - peak_hz) > 0.30 * f0
    harmonic &= (HNR_BINS > 500) & (HNR_BINS < 8000)
    if np.any(noise) and np.sum(spectrum[harmonic]) > 1e-8:
        HNR_FRAMES.append((start, harmonic, noise))


def spectral_hnr(samples):
    values = []
    for start, harmonic, noise in HNR_FRAMES:
        power = np.abs(np.fft.rfft(samples[start:start + HNR_N] * HNR_WINDOW)) ** 2
        values.append(10 * np.log10(max(1e-20, np.mean(power[harmonic])) / max(1e-20, np.mean(power[noise]))))
    return float(np.median(values))



def check(name, passed, detail):
    checks.append({'name': name, 'pass': bool(passed), 'detail': detail})


def metrics(name, samples, lag=0):
    samples = samples[:len(original)]
    windows = window_rms(samples)
    levels = 20 * np.log10(np.maximum(windows, 1e-10))
    frequencies, times, spectrum = signal.stft(samples, fs=SR, nperseg=2048, noverlap=1536, boundary=None)
    magnitudes = np.abs(spectrum)
    centroid = float(np.sum(frequencies[:, None] * magnitudes) / max(np.sum(magnitudes), 1e-20))
    pitches, confidence = pitch_track(samples)
    voiced = np.isfinite(pitches) & np.isfinite(pitch_original)
    # Require a stable original neighborhood; no outlier filtering by processed pitch.
    stable = np.zeros(len(pitch_original), dtype=bool)
    for i in range(1, len(stable) - 1):
        region = pitch_original[i - 1:i + 2]
        if np.all(np.isfinite(region)) and np.ptp(1200 * np.log2(region)) < 60:
            stable[i] = True
    mask = voiced & stable
    median = float(np.median(pitches[mask])) if np.any(mask) else float('nan')
    reference_median = float(np.median(pitch_original[mask])) if np.any(mask) else float('nan')
    cents = float(1200 * np.log2(median / reference_median))
    paired = 1200 * np.log2(pitches[mask] / pitch_original[mask])
    result = {
        'name': name, 'samples': len(samples), 'rms': float(np.sqrt(np.mean(samples ** 2))),
        'rms_dbfs': float(20 * np.log10(max(np.sqrt(np.mean(samples ** 2)), 1e-12))),
        'peak': float(np.max(np.abs(samples))), 'clip_samples': int(np.sum(np.abs(samples) >= 0.999)),
        'centroid_hz': centroid, 'dr_all_db': float(np.percentile(levels, 95) - np.percentile(levels, 5)),
        'dr_active_db': float(np.percentile(levels[active_windows], 95) - np.percentile(levels[active_windows], 5)),
        'f0_median_hz': median, 'f0_reference_median_hz': reference_median,
        'f0_delta_cent': cents, 'f0_paired_median_abs_cent': float(np.median(np.abs(paired))),
        'f0_paired_p95_abs_cent': float(np.percentile(np.abs(paired), 95)),
        'voiced_frames': int(np.sum(mask)), 'stable_reference_frames': int(np.sum(stable)),
         'measured_delay_samples': lag,
        'spectral_hnr_db': spectral_hnr(samples), 'hnr_frames': len(HNR_FRAMES),
        'difference_rms': float(np.sqrt(np.mean((samples - original) ** 2))),
        'rms_matched_difference': float(np.sqrt(np.mean((samples * np.sqrt(np.mean(original ** 2) / max(1e-20, np.mean(samples ** 2))) - original) ** 2))),
        'dropout_windows': int(np.sum(windows[active_windows] < original_rms_windows[active_windows] * 0.1)),

    }
    rows.append(result)
    check(f'{name}: finite/non-silent/no clipping', np.all(np.isfinite(samples)) and result['rms'] > 1e-4 and result['clip_samples'] == 0 and result['peak'] < 0.99, f"RMS={result['rms']:.6f}, peak={result['peak']:.6f}")
    check(f'{name}: F0 unchanged', np.sum(mask) >= 40 and abs(cents) < 20 and np.median(np.abs(paired)) < 20, f"median delta={cents:.3f} cent; paired abs median={np.median(np.abs(paired)):.3f} cent; frames={np.sum(mask)}")
    check(f'{name}: no active dropout', result['dropout_windows'] == 0, f"{result['dropout_windows']} / {int(np.sum(active_windows))} active windows")
    return result


# Positive controls: the analyzer must detect a real 50-cent change, and high F0.
known_tracks = []
for known in [200, 200 * 2 ** (50 / 1200), 650]:
    t = np.arange(SR) / SR
    measured, _ = pitch_track(0.1 * np.sin(2 * np.pi * known * t))
    estimate = float(np.nanmedian(measured))
    known_tracks.append(estimate)
    check(f'F0 estimator positive control {known:.3f} Hz', abs(1200 * np.log2(estimate / known)) < 2, f'measured {estimate:.6f} Hz')
known_shift = 1200 * np.log2(known_tracks[1] / known_tracks[0])
check('F0 estimator detects a real 50-cent change', 48 < known_shift < 52, f'measured {known_shift:.6f} cent')

metrics('source', original)
for amount in [0, 0.5, 1]:
    for variant in ['cli', 'browser']:
        raw = np.fromfile(OUT / f'v2-{variant}-{amount}.f32', dtype='<f4').astype(np.float64)
        check(f'{variant}-{amount}: exact PCM length', len(raw) == len(original), f'{len(raw)} / {len(original)}')
        metrics(f'{variant}-pcm-{amount}', raw)
        if amount == 0:
            error = float(np.max(np.abs(raw - original)))
            check(f'{variant}: exact bypass PCM', error == 0, f'max abs error={error}')
        path = DEMO / f'vocaloid-v2-{amount}.mp3' if variant == 'cli' else OUT / f'browser-vocaloid-v2-{amount}.mp3'
        decoded = decode(path)
        aligned, lag = align(original, decoded)
        metrics(f'{variant}-mp3-{amount}', aligned, lag)
    a = np.fromfile(OUT / f'v2-cli-{amount}.f32', dtype='<f4')
    b = np.fromfile(OUT / f'v2-browser-{amount}.f32', dtype='<f4')
    error = float(np.max(np.abs(a - b)))
    check(f'cross-platform PCM {amount}', error < 1e-5, f'max abs difference={error}')
    cli = next(row for row in rows if row['name'] == f'cli-mp3-{amount}')
    browser = next(row for row in rows if row['name'] == f'browser-mp3-{amount}')
    for key in ['rms', 'centroid_hz']:
        difference = abs(cli[key] - browser[key]) / max(abs(cli[key]), 1e-12)
        check(f'cross-platform MP3 {amount}: {key}', difference < 0.05, f'relative difference={difference:.6%}')

base = next(row for row in rows if row['name'] == 'cli-pcm-0')
for amount in [0.5, 1]:
    wet = np.fromfile(OUT / f'v2-cli-{amount}.f32', dtype='<f4')
    difference_rms = float(np.sqrt(np.mean((wet - original) ** 2)))
    check(f'amount {amount}: audible signal change', difference_rms > 0.005, f'difference RMS={difference_rms:.6f}')
    row = next(row for row in rows if row['name'] == f'cli-pcm-{amount}')
    check(f'amount {amount}: active dynamics reduced', row['dr_active_db'] < base['dr_active_db'], f"{base['dr_active_db']:.3f} -> {row['dr_active_db']:.3f} dB")

strong = next(row for row in rows if row['name'] == 'cli-pcm-1')
check('v2: centroid rise', strong['centroid_hz'] - base['centroid_hz'] >= 800 or strong['centroid_hz'] / base['centroid_hz'] >= 1.3, f"{base['centroid_hz']:.2f} -> {strong['centroid_hz']:.2f} Hz")
check('v2: spectral HNR rise >=6 dB', strong['spectral_hnr_db'] - base['spectral_hnr_db'] >= 6, f"{base['spectral_hnr_db']:.2f} -> {strong['spectral_hnr_db']:.2f} dB; {len(HNR_FRAMES)} fixed source frames")
check('v2: active DR falls >=3 dB', base['dr_active_db'] - strong['dr_active_db'] >= 3, f"{base['dr_active_db']:.2f} -> {strong['dr_active_db']:.2f} dB")
check('v2: large difference, beyond v1', strong['difference_rms'] > 0.10, f"RMS difference={strong['difference_rms']:.6f}; v1=0.052629")
# A separate level-independent check prevents makeup gain from passing on its own.
check('v2: level-matched difference beyond v1', strong['rms_matched_difference'] > 0.0299732012 * 1.3, f"matched difference={strong['rms_matched_difference']:.6f}; v1=0.029973")

passed = all(item['pass'] for item in checks)
result = {'pass': passed, 'sample_rate': SR, 'source_frames': len(original), 'source_duration_s': len(original) / SR, 'rows': rows, 'checks': checks}
(OUT / 'v2-analysis.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
lines = ['| 出力 | RMS dBFS | peak | 重心 Hz | 発声DR dB | 調波/雑音 dB | 差分RMS | RMS整合差分 | F0 Hz | Δ cent | 対応差 median/p95 cent | dropout |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
for row in rows:
    lines.append(f"| {row['name']} | {row['rms_dbfs']:.2f} | {row['peak']:.4f} | {row['centroid_hz']:.1f} | {row['dr_active_db']:.2f} | {row['spectral_hnr_db']:.2f} | {row['difference_rms']:.6f} | {row['rms_matched_difference']:.6f} | {row['f0_median_hz']:.2f} | {row['f0_delta_cent']:+.2f} | {row['f0_paired_median_abs_cent']:.2f}/{row['f0_paired_p95_abs_cent']:.2f} | {row['dropout_windows']} |")
lines += ['', f"判定: {'PASS' if passed else 'FAIL'} — {sum(item['pass'] for item in checks)}/{len(checks)} checks", '']
for item in checks:
    lines.append(f"- {'PASS' if item['pass'] else 'FAIL'} {item['name']}: {item['detail']}")
(OUT / 'v2-analysis.md').write_text('\n'.join(lines) + '\n')
print('\n'.join(lines))
raise SystemExit(0 if passed else 1)
