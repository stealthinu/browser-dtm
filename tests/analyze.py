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
DEMO = Path(os.environ.get('VOCALOID_DEMO_DIR', '/workspace/vocaloid-filter-demo'))
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
    rate = 11025
    data = signal.resample_poly(samples, 1, 4)
    frame, hop = 1024, 220
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
    }
    rows.append(result)
    check(f'{name}: finite/non-silent/no clipping', np.all(np.isfinite(samples)) and result['rms'] > 1e-4 and result['clip_samples'] == 0, f"RMS={result['rms']:.6f}, peak={result['peak']:.6f}")
    check(f'{name}: F0 unchanged', np.sum(mask) >= 40 and abs(cents) < 20 and np.median(np.abs(paired)) < 20, f"median delta={cents:.3f} cent; paired abs median={np.median(np.abs(paired)):.3f} cent; frames={np.sum(mask)}")
    return result


metrics('source', original)
for amount in [0, 0.5, 1]:
    for variant in ['cli', 'browser']:
        raw = np.fromfile(OUT / f'{variant}-{amount}.f32', dtype='<f4').astype(np.float64)
        check(f'{variant}-{amount}: exact PCM length', len(raw) == len(original), f'{len(raw)} / {len(original)}')
        metrics(f'{variant}-pcm-{amount}', raw)
        if amount == 0:
            error = float(np.max(np.abs(raw - original)))
            check(f'{variant}: exact bypass PCM', error == 0, f'max abs error={error}')
        path = DEMO / f'vocaloid-{amount}.mp3' if variant == 'cli' else OUT / f'browser-vocaloid-{amount}.mp3'
        decoded = decode(path)
        aligned, lag = align(original, decoded)
        metrics(f'{variant}-mp3-{amount}', aligned, lag)
    a = np.fromfile(OUT / f'cli-{amount}.f32', dtype='<f4')
    b = np.fromfile(OUT / f'browser-{amount}.f32', dtype='<f4')
    error = float(np.max(np.abs(a - b)))
    check(f'cross-platform PCM {amount}', error < 1e-5, f'max abs difference={error}')
    cli = next(row for row in rows if row['name'] == f'cli-mp3-{amount}')
    browser = next(row for row in rows if row['name'] == f'browser-mp3-{amount}')
    for key in ['rms', 'centroid_hz']:
        difference = abs(cli[key] - browser[key]) / max(abs(cli[key]), 1e-12)
        check(f'cross-platform MP3 {amount}: {key}', difference < 0.05, f'relative difference={difference:.6%}')

base = next(row for row in rows if row['name'] == 'cli-pcm-0')
for amount in [0.5, 1]:
    wet = np.fromfile(OUT / f'cli-{amount}.f32', dtype='<f4')
    difference_rms = float(np.sqrt(np.mean((wet - original) ** 2)))
    check(f'amount {amount}: audible signal change', difference_rms > 0.005, f'difference RMS={difference_rms:.6f}')
    row = next(row for row in rows if row['name'] == f'cli-pcm-{amount}')
    check(f'amount {amount}: active dynamics reduced', row['dr_active_db'] < base['dr_active_db'], f"{base['dr_active_db']:.3f} -> {row['dr_active_db']:.3f} dB")

passed = all(item['pass'] for item in checks)
result = {'pass': passed, 'sample_rate': SR, 'source_frames': len(original), 'source_duration_s': len(original) / SR, 'rows': rows, 'checks': checks}
(OUT / 'analysis.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
lines = ['| 出力 | RMS dBFS | peak | 重心 Hz | DR 全体/有声 dB | F0 Hz | Δ cent | 対応窓絶対差 中央値/p95 cent | 有声窓 | 遅延 samples |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
for row in rows:
    lines.append(f"| {row['name']} | {row['rms_dbfs']:.2f} | {row['peak']:.4f} | {row['centroid_hz']:.1f} | {row['dr_all_db']:.2f}/{row['dr_active_db']:.2f} | {row['f0_median_hz']:.2f} | {row['f0_delta_cent']:+.2f} | {row['f0_paired_median_abs_cent']:.2f}/{row['f0_paired_p95_abs_cent']:.2f} | {row['voiced_frames']} | {row['measured_delay_samples']} |")
lines += ['', f"判定: {'PASS' if passed else 'FAIL'} — {sum(item['pass'] for item in checks)}/{len(checks)} checks", '', 'F0: 11,025 Hzへ検査用にのみ変換、1024 sample窓・220 sample hopのYIN型推定（70〜700 Hz）。原音の連続3窓が60 cent以内の安定区間を選び、各出力でも有声と判定した対応窓を比較。推定器の倍音誤認を隠すためのcent外れ値除外は行わない。DR有声は原音の20ms RMSが−40dBFSを超える固定窓。MP3は相互相関で符号化遅延を測って整列。', '']
for item in checks:
    lines.append(f"- {'PASS' if item['pass'] else 'FAIL'} {item['name']}: {item['detail']}")
(OUT / 'analysis.md').write_text('\n'.join(lines) + '\n')
print('\n'.join(lines))
raise SystemExit(0 if passed else 1)
