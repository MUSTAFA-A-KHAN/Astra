"""Records the heroes' spoken lines with Microsoft's neural voices.

    python tools/generate-voice.py [hero id ...]      (default: every hero cast)

tools/voice-direction.mjs says who speaks, what they say and how each line
feels; this records every line for each hero into assets/audio/voice/<hero>/
and writes voice-manifest.js, which the game looks the lines up in.

A line is recorded a sentence at a time (a clause at a time for feelings that
ask for it), each piece shaped for the feeling, then the pieces are trimmed of
their own silence and joined with the feeling's pauses. The whole is filtered
of rumble, gently compressed, brought to a common loudness and, for spells,
given an echo, then saved as Ogg Vorbis with an AAC twin like every other
sound in the game.

The voice is Microsoft Edge's free read-aloud service unless AZURE_SPEECH_KEY
and AZURE_SPEECH_REGION are set, in which case it is Azure Speech with the
feeling's speaking style as well. A file is named for everything that goes
into it, so only lines whose words, feeling, voice or service have changed are
recorded again, and recordings nothing uses any more are removed.

Requires edge-tts and imageio-ffmpeg (pip install edge-tts imageio-ffmpeg), or
an ffmpeg on the PATH, and Node for the direction.
"""

import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'audio' / 'voice'
MANIFEST = ROOT / 'voice-manifest.js'
LOUDNESS = -18      # LUFS: speech sits a little under the effects' peaks
TAIL = .12          # seconds of quiet after the last word; spells ring on for longer
ECHO_TAIL = .7


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        found = shutil.which('ffmpeg')
        if not found: sys.exit('ffmpeg is needed: pip install imageio-ffmpeg')
        return found


def direction():
    out = subprocess.run(['node', str(ROOT / 'tools' / 'voice-direction.mjs')], capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(out.stdout)


def pieces(text, feeling):
    """The line split where the feeling pauses, each piece with its pause after it."""
    sentences = [s for s in re.split(r'(?<=[.!?…])\s+', text.strip()) if s]
    out = []
    for sentence in sentences:
        clauses = [c for c in re.split(r'(?<=[,;—])\s+', sentence) if c] if feeling.get('commas') else [sentence]
        for c, clause in enumerate(clauses):
            last = c == len(clauses) - 1
            out.append((clause, feeling['pause'] if last else feeling['commas']))
    out[-1] = (out[-1][0], ECHO_TAIL if feeling.get('echo') else TAIL)
    return out


def prosody(cast, feeling, index):
    arc = feeling.get('arc', {})
    rate = cast.get('rate', 0) + feeling.get('rate', 0) + arc.get('rate', 0) * index
    pitch = cast.get('pitch', 0) + feeling.get('pitch', 0) + arc.get('pitch', 0) * index
    volume = feeling.get('volume', 0) + arc.get('volume', 0) * index
    return f'{rate:+d}%', f'{pitch:+d}Hz', f'{volume:+d}%'


async def edge(text, voice, rate, pitch, volume):
    import edge_tts
    audio = b''
    async for chunk in edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume).stream():
        if chunk['type'] == 'audio': audio += chunk['data']
    return audio


def azure(text, voice, rate, pitch, volume, style=None, degree=1):
    key, region = os.environ['AZURE_SPEECH_KEY'], os.environ['AZURE_SPEECH_REGION']
    body = f"<prosody rate='{rate}' pitch='{pitch}' volume='{volume}'>{escape(text)}</prosody>"
    if style: body = f"<mstts:express-as style='{style}' styledegree='{degree}'>{body}</mstts:express-as>"
    ssml = ("<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'>"
            f"<voice name='{voice}'>{body}</voice></speak>")
    request = urllib.request.Request(f'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1', data=ssml.encode(), headers={
        'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3', 'User-Agent': 'astra-voice'})
    with urllib.request.urlopen(request, timeout=60) as response: return response.read()


def service():
    return 'azure' if os.environ.get('AZURE_SPEECH_KEY') and os.environ.get('AZURE_SPEECH_REGION') else 'edge'


def take_name(cast, line, feeling, backend):
    """The file a line is recorded to: its opening words, and a hash of everything that shapes it."""
    voice = cast['azure' if backend == 'azure' else 'edge']
    shaped = json.dumps([line['text'], feeling, voice, cast.get('pitch'), cast.get('rate'), backend, LOUDNESS, TAIL, ECHO_TAIL], sort_keys=True)
    words = re.sub(r'[^a-z0-9]+', '-', line['text'].lower().replace('’', '').replace("'", '')).strip('-').split('-')
    return f"{'-'.join(words[:6])}-{hashlib.sha1(shaped.encode()).hexdigest()[:6]}"


async def record(ff, cast, line, feeling, backend, stem, work):
    parts, gaps = [], []
    for index, (text, gap) in enumerate(pieces(line['text'], feeling)):
        rate, pitch, volume = prosody(cast, feeling, index)
        if backend == 'azure':
            audio = await asyncio.to_thread(azure, text, cast['azure'], rate, pitch, volume, feeling.get('style'), feeling.get('degree', 1))
        else:
            audio = await edge(text, cast['edge'], rate, pitch, volume)
        if not audio: raise RuntimeError(f'no audio for “{text}”')
        part = work / f'{stem}-{index}.mp3'; part.write_bytes(audio)
        parts.append(part); gaps.append(gap)
    # Each piece loses the silence the voice leaves around it and takes the
    # feeling's pause instead; then the line is finished as one.
    trim = ('aresample=44100,aformat=channel_layouts=mono,'
            'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02,areverse,'
            'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.04,areverse')
    graph = [f'[{i}:a]{trim},apad=pad_dur={gap}[p{i}]' for i, gap in enumerate(gaps)]
    finish = ['highpass=f=85', 'acompressor=threshold=-22dB:ratio=2.5:attack=6:release=140']
    if feeling.get('echo'): finish.append('aecho=0.85:0.7:75|170:0.24|0.12')
    finish += [f'loudnorm=I={LOUDNESS}:TP=-2:LRA=9', 'aresample=44100', 'afade=t=in:d=0.012', 'areverse,afade=t=in:d=0.06,areverse']
    graph.append(''.join(f'[p{i}]' for i in range(len(parts))) + f'concat=n={len(parts)}:v=0:a=1,' + ','.join(finish) + '[out]')
    wav = work / f'{stem}.wav'
    inputs = [arg for part in parts for arg in ('-i', str(part))]
    run = lambda *args: subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)
    run(*inputs, '-filter_complex', ';'.join(graph), '-map', '[out]', '-ac', '1', '-c:a', 'pcm_s16le', str(wav))
    run('-i', str(wav), '-c:a', 'libvorbis', '-q:a', '4', str(work / f'{stem}.ogg'))
    run('-i', str(wav), '-c:a', 'aac', '-b:a', '80k', '-movflags', '+faststart', str(work / f'{stem}.m4a'))


def manifest(heroes):
    out = ['// Generated by tools/generate-voice.py from tools/voice-direction.mjs: edit those, not this.',
           '// Each hero who speaks their lines aloud, and the recording for each line,',
           '// by its words, under assets/audio/.',
           'export const HERO_VOICES = Object.freeze({']
    for hero, lines in heroes.items():
        out.append(f'  {json.dumps(hero)}: Object.freeze({{')
        out += [f'    {json.dumps(text, ensure_ascii=False)}: {json.dumps(file)},' for text, file in lines.items()]
        out.append('  }),')
    out.append('});')
    MANIFEST.write_text('\n'.join(out) + '\n', encoding='utf-8')


async def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ff, plan, backend = ffmpeg(), direction(), service()
    wanted = sys.argv[1:] or list(plan['cast'])
    for hero in wanted:
        if hero not in plan['cast']: sys.exit(f'{hero} has no voice in tools/voice-direction.mjs')
    # Heroes not being recorded this time keep what the manifest already has.
    heroes = {}
    if MANIFEST.exists():
        current = MANIFEST.read_text(encoding='utf-8')
        for hero in plan['cast']:
            if hero in wanted: continue
            block = re.search(rf'  {re.escape(json.dumps(hero))}: Object\.freeze\({{\n(.*?)\n  }}\),', current, re.S)
            if block: heroes[hero] = json.loads('{' + block.group(1).rstrip(',') + '}')
    print(f'Recording with {"Azure Speech" if backend == "azure" else "Microsoft Edge read-aloud"}.')
    for hero in wanted:
        cast, folder = plan['cast'][hero], OUT / hero.lower()
        folder.mkdir(parents=True, exist_ok=True)
        heroes[hero], keep = {}, set()
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            for line in plan['lines']:
                feeling = plan['feelings'][line['feeling']]
                stem = take_name(cast, line, feeling, backend)
                keep |= {f'{stem}.ogg', f'{stem}.m4a'}
                heroes[hero][line['text']] = f'voice/{hero.lower()}/{stem}.ogg'
                if (folder / f'{stem}.ogg').exists() and (folder / f'{stem}.m4a').exists():
                    print(f'  {hero} · {line["feeling"]:<11} · kept      {line["text"]}'); continue
                await record(ff, cast, line, feeling, backend, stem, work)
                for suffix in ('.ogg', '.m4a'): shutil.move(work / f'{stem}{suffix}', folder / f'{stem}{suffix}')
                print(f'  {hero} · {line["feeling"]:<11} · recorded  {line["text"]}')
        for stale in folder.iterdir():
            if stale.name not in keep: stale.unlink(); print(f'  {hero} · removed {stale.name}')
    manifest({hero: heroes[hero] for hero in plan['cast'] if hero in heroes})


if __name__ == '__main__':
    asyncio.run(main())
