"""Render Astra's original opening sound design, with no third-party samples.

    python tools/generate-opening-audio.py

Writes Ogg/AAC pairs used by audio-manifest.js. The bell's inharmonic partials,
the breach's falling pitch/noise, and the ward's rising chord are deterministic
so each mix is reproducible. Requires imageio-ffmpeg or ffmpeg on PATH.
"""
import math
import random
import shutil
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'audio' / 'opening'
RATE = 44100


def bell(t, noise):
    attack = min(1, t / .012)
    partials = ((110, 1, 2.5), (221.8, .52, 2.0), (296.6, .31, 1.4),
                (447, .22, 1.0), (571, .12, .75), (719, .06, .5))
    toll = sum(level * math.sin(math.tau * freq * t) * math.exp(-t / decay)
               for freq, level, decay in partials)
    return attack * (toll * .37 + noise * .08 * math.exp(-t * 55))


def breach(t, noise):
    envelope = min(1, t / .12) * math.exp(-max(0, t - .25) / .9)
    phase = math.tau * (42 * t + 96 * (1 - math.exp(-t * 2)) / 2)
    rumble = math.sin(phase) + .3 * math.sin(phase * 1.013)
    crackle = noise * (.07 + .25 * math.exp(-t * 9))
    return envelope * (.38 * rumble + crackle)


def ward(t, noise):
    envelope = min(1, t / .045) * math.exp(-t / .48)
    chord = sum(math.sin(math.tau * frequency * t) * level
                for frequency, level in ((330, .48), (440, .3), (660, .2), (880, .07)))
    return envelope * chord


def main():
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise SystemExit('Install imageio-ffmpeg or put ffmpeg on PATH.')
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        for name, duration, sound in [('drowned-bell', 5.4, bell), ('rift-breach', 3.8, breach), ('ward-pulse', 2.3, ward)]:
            rng = random.Random(29)
            samples = []
            filtered_noise = 0
            for i in range(round(duration * RATE)):
                t = i / RATE
                filtered_noise = .91 * filtered_noise + .09 * rng.uniform(-1, 1)
                fade = min(1, max(0, (duration - t) / .25))
                samples.append(sound(t, filtered_noise) * fade)
            scale = .82 / max(abs(sample) for sample in samples)
            wav = Path(temporary) / f'{name}.wav'
            with wave.open(str(wav), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(RATE)
                output.writeframes(b''.join(struct.pack('<h', round(sample * scale * 32767)) for sample in samples))
            for extension, codec in [('ogg', ['-c:a', 'libvorbis', '-q:a', '4']), ('m4a', ['-c:a', 'aac', '-b:a', '80k', '-movflags', '+faststart'])]:
                destination = OUT / f'{name}.{extension}'
                subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav), *codec, str(destination)], check=True)
                print(destination.relative_to(ROOT))


if __name__ == '__main__':
    main()
