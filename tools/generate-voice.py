"""Records the story's spoken lines with Microsoft's neural voices.

    python tools/generate-voice.py [id ...]      (default: the whole cast)

tools/voice-direction.mjs says who is voiced, what they say and how each line
feels; this records every line of each member of the cast (a hero id, or a
person such as maren) into assets/audio/voice/heroes/<hero>/ or
assets/audio/voice/people/<person>/, and writes voice-manifest.js, which the
game looks the lines up in.

A line is recorded a sentence at a time (a clause at a time for feelings that
ask for it), each piece shaped for the feeling, then the pieces are trimmed of
their own silence and joined with the feeling's pauses. The whole is filtered
of rumble, gently compressed, given the echo its speaker or feeling asks for
and brought to a common loudness, then saved as Ogg Vorbis with an AAC twin
like every other sound in the game.

The voice is Microsoft Edge's free read-aloud service unless AZURE_SPEECH_KEY
and AZURE_SPEECH_REGION are set, in which case it is Azure Speech with the
feeling's speaking style as well. A file is named for everything that goes
into it, so only lines whose words, feeling, voice or service have changed are
recorded again, and recordings nothing uses any more are removed. Naming ids
records only those members; the manifest still lists everyone.

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
AUDIO = ROOT / 'assets' / 'audio'
OUT = AUDIO / 'voice'
MANIFEST = ROOT / 'voice-manifest.js'
LOUDNESS = -18      # LUFS: speech sits a little under the effects' peaks
TAIL = .12          # seconds of quiet after the last word, unless an echo rings on
# An echo, and how long it is let ring after the last word: a spell's ring,
# and the faint one a ghost's voice carries.
ECHOES = {
    'ring': ('aecho=0.85:0.7:75|170:0.24|0.12', .7),
    'faint': ('aecho=0.8:0.5:40|95:0.14|0.07', .3),
}
AT_ONCE = 4         # lines recorded side by side


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


def echo_of(cast, feeling):
    return ECHOES.get(feeling.get('echo') or cast.get('echo'))


def pieces(text, cast, feeling):
    """The line split where the feeling pauses, each piece with its pause after it."""
    out = []
    for sentence in [s for s in re.split(r'(?<=[.!?…])\s+', text.strip()) if s]:
        clauses = [c for c in re.split(r'(?<=[,;—])\s+', sentence) if c] if feeling.get('commas') else [sentence]
        for c, clause in enumerate(clauses):
            out.append((clause, feeling['pause'] if c == len(clauses) - 1 else feeling['commas']))
    echo = echo_of(cast, feeling)
    out[-1] = (out[-1][0], echo[1] if echo else TAIL)
    return out


def prosody(cast, feeling, index):
    """Rate, pitch and volume for a piece: the cast's and the feeling's, and the feeling's arc so far."""
    arc = feeling.get('arc', {})
    total = lambda key, own=0: own + feeling.get(key, 0) + arc.get(key, 0) * index
    rate, volume = round(total('rate', cast.get('rate', 0))), round(total('volume'))
    pitch = round(total('pitch', cast.get('pitch', 0)) * cast['f0'] / 100)
    return f'{rate:+d}%', f'{pitch:+d}Hz', f'{volume:+d}%'


async def edge(text, voice, rate, pitch, volume):
    import edge_tts
    # The service drops a connection now and then; a moment later it answers.
    for attempt in range(4):
        try:
            audio = b''
            async for chunk in edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume).stream():
                if chunk['type'] == 'audio': audio += chunk['data']
            if audio: return audio
        except Exception:
            if attempt == 3: raise
        await asyncio.sleep(2 * (attempt + 1))
    return b''


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
    shaped = json.dumps([line['text'], feeling, cast, backend, LOUDNESS, TAIL, echo_of(cast, feeling)], sort_keys=True)
    words = re.sub(r'[^a-z0-9]+', '-', line['text'].lower().replace('’', '').replace("'", '')).strip('-').split('-')
    return f"{'-'.join(words[:6])}-{hashlib.sha1(shaped.encode()).hexdigest()[:6]}"


async def record(ff, cast, line, feeling, backend, stem, work):
    parts, gaps = [], []
    for index, (text, gap) in enumerate(pieces(line['text'], cast, feeling)):
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
    echo = echo_of(cast, feeling)
    if echo: finish.append(echo[0])
    finish += [f'loudnorm=I={LOUDNESS}:TP=-2:LRA=9', 'aresample=44100', 'afade=t=in:d=0.012', 'areverse,afade=t=in:d=0.06,areverse']
    graph.append(''.join(f'[p{i}]' for i in range(len(parts))) + f'concat=n={len(parts)}:v=0:a=1,' + ','.join(finish) + '[out]')
    wav = work / f'{stem}.wav'
    inputs = [arg for part in parts for arg in ('-i', str(part))]
    run = lambda *args: subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)
    await asyncio.to_thread(run, *inputs, '-filter_complex', ';'.join(graph), '-map', '[out]', '-ac', '1', '-c:a', 'pcm_s16le', str(wav))
    await asyncio.to_thread(run, '-i', str(wav), '-c:a', 'libvorbis', '-q:a', '4', str(work / f'{stem}.ogg'))
    await asyncio.to_thread(run, '-i', str(wav), '-c:a', 'aac', '-b:a', '80k', '-movflags', '+faststart', str(work / f'{stem}.m4a'))


def manifest(voices):
    out = ['// Generated by tools/generate-voice.py from tools/voice-direction.mjs: edit those, not this.',
           '// Everyone who speaks aloud, and the recording of each of their lines, by',
           '// its words, under assets/audio/: heroes by hero id, people by voice.',
           'export const VOICES = Object.freeze({']
    for kind in ('heroes', 'people'):
        out.append(f'  {kind}: Object.freeze({{')
        for member, lines in voices[kind].items():
            out.append(f'    {json.dumps(member)}: Object.freeze({{')
            out += [f'      {json.dumps(text, ensure_ascii=False)}: {json.dumps(file)},' for text, file in lines.items()]
            out.append('    }),')
        out.append('  }),')
    out.append('});')
    MANIFEST.write_text('\n'.join(out) + '\n', encoding='utf-8')


async def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ff, plan, backend = ffmpeg(), direction(), service()
    members = [(kind, member) for kind in ('heroes', 'people') for member in plan['cast'][kind]]
    wanted = set(sys.argv[1:]) or {member for _, member in members}
    unknown = wanted - {member for _, member in members}
    if unknown: sys.exit(f'{", ".join(sorted(unknown))}: not in the cast in tools/voice-direction.mjs')
    print(f'Recording with {"Azure Speech" if backend == "azure" else "Microsoft Edge read-aloud"}.')
    voices, keep, missing = {'heroes': {}, 'people': {}}, set(), []
    at_once = asyncio.Semaphore(AT_ONCE)
    with tempfile.TemporaryDirectory() as temp:
        work = Path(temp)

        async def take(member, cast, line, feeling, stem, file):
            async with at_once:
                await record(ff, cast, line, feeling, backend, stem, work)
            for suffix in ('.ogg', '.m4a'): shutil.move(work / f'{stem}{suffix}', file.with_suffix(suffix))
            print(f'  {member} · {line["feeling"]:<11} · recorded  {line["text"]}')

        jobs = []
        for kind, member in members:
            cast, folder = plan['cast'][kind][member], f'voice/{kind}/{member.lower()}'
            voices[kind][member] = {}
            (AUDIO / folder).mkdir(parents=True, exist_ok=True)
            for line in plan['scripts'][kind][member]:
                feeling = plan['feelings'][line['feeling']]
                stem = take_name(cast, line, feeling, backend)
                file = AUDIO / folder / f'{stem}.ogg'
                voices[kind][member][line['text']] = f'{folder}/{stem}.ogg'
                keep |= {file, file.with_suffix('.m4a')}
                if file.exists() and file.with_suffix('.m4a').exists(): continue
                if member in wanted: jobs.append(take(member, cast, line, feeling, stem, file))
                else: missing.append(f'{member}: {line["text"]}')
        await asyncio.gather(*jobs)
    kept = sum(len(lines) for kind in voices.values() for lines in kind.values()) - len(jobs) - len(missing)
    print(f'{len(jobs)} recorded, {kept} kept.')
    for stale in sorted(p for p in OUT.rglob('*') if p.is_file() and p not in keep):
        stale.unlink(); print(f'  removed {stale.relative_to(AUDIO).as_posix()}')
    for folder in sorted((p for p in OUT.rglob('*') if p.is_dir()), reverse=True):
        if not any(folder.iterdir()): folder.rmdir()
    if missing: print(f'Not recorded, as only {", ".join(sorted(wanted))} were asked for:', *missing, sep='\n  ')
    manifest(voices)


if __name__ == '__main__':
    asyncio.run(main())
