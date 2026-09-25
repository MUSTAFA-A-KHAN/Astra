import { AUDIO_ASSETS } from './audio-manifest.js';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const MUSIC_STATES = new Set(['exploration', 'suspicion', 'combat', 'victory']);
// Loaded first, ahead of ambience and music. Every walk is among them, so the
// first steps on new ground are not lost while its recording downloads.
const WALKS = Object.keys(AUDIO_ASSETS).filter(name => AUDIO_ASSETS[name].steps);
const CORE = [...WALKS, 'sword', 'jump', 'landing', 'hit', 'climb', 'interaction'];
// How loud a step is brought to, whatever level it was recorded at: the RMS
// of its loudest hundredth of a second.
const STEP_LEVEL = .05;

/** Which walk a stride plays: the horse's when riding, otherwise the ground's, dirt by default. */
export function footstepSurface(surface = '', mounted = false) {
  if (mounted) return 'walkHorse';
  if (/water|lake|river|wet/i.test(surface)) return 'walkWater';
  if (/forest|grass|meadow/i.test(surface)) return 'walkGrass';
  if (/plaza|gravel|cobble/i.test(surface)) return 'walkGravel';
  return 'walkDirt';
}

/**
 * Where the single steps are in a walking recording. Each starts just before
 * a footfall and runs until the next, and carries the gain that brings it to
 * STEP_LEVEL. Steps too faint beside the rest (someone walking up from far
 * off) are left out, rather than raised along with their hiss.
 */
export function stepSlices(buffer) {
  const rate = buffer.sampleRate, window = Math.max(1, Math.round(rate * .01)), channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const envelope = new Float32Array(Math.floor(channels[0].length / window));
  for (let w = 0; w < envelope.length; w++) {
    let sum = 0;
    for (const data of channels) for (let i = w * window, end = i + window; i < end; i++) sum += data[i] * data[i];
    envelope[w] = Math.sqrt(sum / (window * channels.length));
  }
  const sorted = Float32Array.from(envelope).sort(), peak = sorted[sorted.length - 1] || 0, floor = sorted[sorted.length >> 1] || 0;
  if (!peak) return [];
  // A footfall is where the level rises through a quarter of the way from the
  // background to the loudest step, at least 0.22 s after the last.
  const threshold = floor + (peak - floor) * .25, onsets = [];
  for (let w = 0; w < envelope.length; w++) {
    if (envelope[w] > threshold && (w === 0 || envelope[w - 1] <= threshold) && (!onsets.length || w - onsets[onsets.length - 1] >= 22)) onsets.push(w);
  }
  const slices = [];
  onsets.forEach((w, i) => {
    const start = Math.max(0, w - 3), end = Math.min(envelope.length, w + 45, onsets[i + 1] === undefined ? Infinity : onsets[i + 1] - 2);
    let loudest = 0;
    for (let k = w; k < end; k++) loudest = Math.max(loudest, envelope[k]);
    if (loudest < peak * .3) return;
    // Never more than twelvefold: a recording of near silence is not raised into a roar of hiss.
    slices.push({ offset: start * window / rate, duration: (end - start) * window / rate, gain: Math.min(12, STEP_LEVEL / loudest) });
  });
  return slices;
}

/** Safari decodes AAC natively but Vorbis late or not at all, so anything short of a confident "probably" gets the .m4a twins. */
function preferredFormat() {
  try { return new Audio().canPlayType('audio/ogg; codecs="vorbis"') === 'probably' ? 'ogg' : 'm4a'; } catch { return 'ogg'; }
}

/** Local licensed recordings only. The game owns and unlocks the AudioContext. */
export class GameAudio {
  constructor({ context = null, enabled = true, fetcher = globalThis.fetch?.bind(globalThis), random = Math.random, format = preferredFormat() } = {}) {
    this.context = null; this.enabled = enabled; this.paused = false; this.disposed = false;
    this.fetcher = fetcher; this.random = random; this.master = null; this.buses = {};
    this.volumes = { master: .75, effects: .8, ambience: .5, music: .3 };
    this.buffers = new Map(); this.pending = new Map(); this.failed = new Set(); this.slices = new WeakMap();
    this.voices = new Set(); this.loops = new Map(); this.lastVariant = new Map(); this.lastEvent = new Map();
    this.generation = 0; this.abort = null; this.queue = []; this.downloads = 0; this.format = format;
    this.musicState = 'exploration'; this.victoryRemaining = 0; this.combatRemaining = 0;
    this.stepDistance = 0; this.wasGrounded = true; this.initializedMotion = false;
    this.climbTimer = 0; this.breathLevel = 0; this.smithTimer = .4; this.animalTimer = 9;
    this.listenerPosition = { x: 0, y: 0, z: 0 }; this.played = 0;
    if (context) this.setContext(context);
  }

  setContext(context) {
    if (!context || this.context === context || this.disposed) return;
    this.release(); this.context = context; this.abort = new AbortController();
    this.master = context.createGain(); this.master.gain.value = 0; this.master.connect(context.destination);
    for (const bus of ['effects', 'ambience', 'music']) {
      const gain = context.createGain(); gain.gain.value = this.volumes[bus]; gain.connect(this.master); this.buses[bus] = gain;
    }
    this.refreshVolume();
    if (this.enabled) this.preload();
  }
  preload() {
    for (const name of CORE) for (const file of AUDIO_ASSETS[name].files) this.load(file);
    for (const name of ['wind', 'birds', 'musicExploration']) this.load(AUDIO_ASSETS[name].files[0]);
  }
  setEnabled(enabled) {
    this.enabled = !!enabled; this.refreshVolume();
    if (!this.enabled) this.stopAll();
    else if (this.context) this.preload();
  }
  /** The game re-asserts this every frame, so only a real change may reset stride and landing tracking. */
  setPaused(paused) {
    if (!!paused === this.paused) return;
    this.paused = !!paused; this.stepDistance = 0; this.initializedMotion = false; this.refreshVolume();
    if (this.paused) this.stopAll();
  }
  setVolumes(volumes = {}) {
    for (const key of Object.keys(this.volumes)) if (Number.isFinite(volumes[key])) this.volumes[key] = clamp(volumes[key]);
    this.refreshVolume();
  }
  refreshVolume() {
    if (!this.master || this.context?.state === 'closed') return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.enabled && !this.paused ? this.volumes.master : 0, now, .06);
    for (const [name, bus] of Object.entries(this.buses)) bus.gain.setTargetAtTime(this.volumes[name], now, .08);
  }
  get active() { return !this.disposed && this.enabled && !this.paused && this.context?.state === 'running'; }

  /** Three concurrent local fetches keep decoding from flooding the render thread. */
  load(file) {
    if (this.buffers.has(file)) return Promise.resolve(this.buffers.get(file));
    if (this.pending.has(file)) return this.pending.get(file);
    if (!this.context || !this.fetcher || this.failed.has(file) || this.disposed) return Promise.resolve(null);
    const generation = this.generation, context = this.context, signal = this.abort.signal;
    const promise = new Promise(resolve => this.queue.push({ file, generation, context, signal, resolve }));
    this.pending.set(file, promise); this.pump(); return promise;
  }
  pump() {
    while (this.downloads < 3 && this.queue.length) {
      const task = this.queue.shift(); this.downloads++;
      Promise.resolve().then(async () => {
        let buffer;
        const tried = this.format;
        try { buffer = await this.decode(task, tried); }
        catch (error) {
          // The format guess was wrong for this browser: the twin serves this file and, once it decodes, every later one.
          // The twin is of the format this file tried, not the format now: a download finishing meanwhile may have switched it.
          if (task.signal.aborted) throw error;
          const other = tried === 'ogg' ? 'm4a' : 'ogg';
          buffer = await this.decode(task, other); this.format = other;
        }
        if (this.generation !== task.generation || this.disposed) return null;
        this.buffers.set(task.file, buffer); return buffer;
      }).catch(() => {
        if (this.generation === task.generation && !task.signal.aborted) this.failed.add(task.file);
        return null;
      }).then(buffer => {
        task.resolve(buffer);
        if (this.generation === task.generation) { this.pending.delete(task.file); this.downloads--; this.pump(); }
      });
    }
  }
  async decode(task, format) {
    const file = task.file.replace(/\.ogg$/, `.${format}`);
    const response = await this.fetcher(new URL(`./assets/audio/${file}`, import.meta.url), { signal: task.signal });
    if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
    return task.context.decodeAudioData(await response.arrayBuffer());
  }
  variant(name) {
    const files = AUDIO_ASSETS[name]?.files;
    if (!files?.length) return null;
    let index = Math.floor(this.random() * files.length) % files.length;
    if (files.length > 1 && index === this.lastVariant.get(name)) index = (index + 1) % files.length;
    this.lastVariant.set(name, index); return files[index];
  }
  /** One step of a walk, from any of its recordings that has loaded, never the step just heard. */
  step(name) {
    const pool = [];
    for (const file of AUDIO_ASSETS[name].files) {
      const buffer = this.buffers.get(file);
      if (!buffer) { this.load(file); continue; }
      if (!this.slices.has(buffer)) this.slices.set(buffer, stepSlices(buffer));
      for (const span of this.slices.get(buffer)) pool.push({ buffer, span });
    }
    if (!pool.length) return null;
    let index = Math.floor(this.random() * pool.length) % pool.length;
    if (pool.length > 1 && index === this.lastVariant.get(name)) index = (index + 1) % pool.length;
    this.lastVariant.set(name, index); return pool[index];
  }
  /** Missed short effects load for the next event; stale sword/hit events never replay late. */
  play(name, { position = null, volume = 1, rate = 1, cooldown = .055 } = {}) {
    const definition = AUDIO_ASSETS[name];
    if (!definition || !this.active || this.voices.size >= 24) return false;
    const now = this.context.currentTime;
    if (now - (this.lastEvent.get(name) ?? -Infinity) < cooldown) return false;
    let buffer, span = null;
    if (definition.steps) {
      const step = this.step(name);
      if (!step) return false;
      ({ buffer, span } = step);
    } else {
      const file = this.variant(name); buffer = this.buffers.get(file);
      if (!buffer) { this.load(file); return false; }
    }
    this.lastEvent.set(name, now);
    this.createVoice(buffer, { bus: definition.bus || 'effects', volume: clamp(volume, 0, 2) * (definition.volume ?? 1) * (span?.gain ?? 1), rate, position, span });
    return true;
  }
  createVoice(buffer, { bus, volume, rate = 1, position = null, loop = false, span = null }) {
    const context = this.context, source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.loop = loop; source.playbackRate.value = clamp(rate, .65, 1.5);
    gain.gain.value = volume; source.connect(gain);
    if (span) {
      // A step cut from a longer recording is faded in and out, so the cut never clicks.
      const now = context.currentTime, length = span.duration / source.playbackRate.value;
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume, now + .006);
      gain.gain.setValueAtTime(volume, now + length - .04); gain.gain.linearRampToValueAtTime(0, now + length);
    }
    let panner = null;
    if (position && context.createPanner) {
      panner = context.createPanner(); panner.panningModel = 'equalpower'; panner.distanceModel = 'inverse';
      panner.refDistance = 4; panner.maxDistance = 65; panner.rolloffFactor = 1.5;
      this.setNodePosition(panner, position); gain.connect(panner); panner.connect(this.buses[bus]);
    } else gain.connect(this.buses[bus]);
    const voice = { source, gain, panner, stopped: false, silentTime: 0, target: volume };
    this.voices.add(voice); this.played++;
    source.onended = () => this.disconnectVoice(voice);
    if (span) source.start(0, span.offset, span.duration);
    else source.start(0, loop && bus !== 'music' ? this.random() * buffer.duration : 0);
    return voice;
  }
  disconnectVoice(voice) {
    if (voice.stopped) return;
    voice.stopped = true; voice.source.disconnect(); voice.gain.disconnect(); voice.panner?.disconnect(); this.voices.delete(voice);
  }
  stopVoice(voice) { if (!voice.stopped) { try { voice.source.stop(); } catch {} this.disconnectVoice(voice); } }
  setNodePosition(node, position) {
    if (node.positionX) {
      node.positionX.value = position.x || 0; node.positionY.value = position.y || 0; node.positionZ.value = position.z || 0;
    } else node.setPosition?.(position.x || 0, position.y || 0, position.z || 0);
  }
  setMusicState(state) {
    state = String(state).toLowerCase();
    if (!MUSIC_STATES.has(state)) return false;
    if (state !== this.musicState && state === 'victory') this.victoryRemaining = 8;
    this.musicState = state;
    if (this.enabled && this.context) this.load(AUDIO_ASSETS[`music${state[0].toUpperCase()}${state.slice(1)}`].files[0]);
    return true;
  }
  loop(name, target, dt, position = null) {
    const definition = AUDIO_ASSETS[name], file = definition.files[0];
    let voice = this.loops.get(name);
    if (!voice && target > .002) {
      const buffer = this.buffers.get(file);
      if (!buffer) { this.load(file); return; }
      voice = this.createVoice(buffer, { bus: definition.bus, volume: 0, loop: true, position }); this.loops.set(name, voice);
    }
    if (!voice) return;
    const volume = target * (definition.volume ?? 1);
    if (voice.target !== volume) {
      voice.gain.gain.setTargetAtTime(volume, this.context.currentTime, definition.bus === 'music' ? .85 : .5); voice.target = volume;
    }
    if (voice.panner && position) this.setNodePosition(voice.panner, position);
    voice.silentTime = target <= .002 ? voice.silentTime + dt : 0;
    if (voice.silentTime > 4) { this.stopVoice(voice); this.loops.delete(name); }
  }
  update(dt, position, biome, locomotion = {}, environment = {}) {
    if (!this.active) return;
    dt = clamp(dt, 0, .15); this.listenerPosition = position || this.listenerPosition;
    this.setNodePosition(this.context.listener, this.listenerPosition);
    const forward = environment.forward;
    if (forward && this.context.listener.forwardX) {
      const listener = this.context.listener;
      listener.forwardX.value = forward.x; listener.forwardY.value = forward.y || 0; listener.forwardZ.value = forward.z;
      listener.upX.value = 0; listener.upY.value = 1; listener.upZ.value = 0;
    }
    const biomeName = String(typeof biome === 'string' ? biome : biome?.id || biome?.name || 'meadow').toLowerCase();
    const surface = locomotion.surface || biomeName;
    const state = String(locomotion.state || '').toLowerCase(), grounded = locomotion.grounded !== false;
    const speed = locomotion.speed ?? Math.hypot(locomotion.velocity?.x || 0, locomotion.velocity?.z || 0);
    const climbing = !!locomotion.climbing || /climb/.test(state), dead = /dead/.test(state);
    if (this.initializedMotion && grounded !== this.wasGrounded && !climbing && !dead) {
      if (grounded) this.play('landing', { volume: clamp((locomotion.impactSpeed || 5) / 9, .35, 1) });
      else if ((locomotion.velocity?.y ?? locomotion.verticalVelocity ?? 0) > 1) this.play('jump', { volume: .65 });
    }
    this.wasGrounded = grounded; this.initializedMotion = true;
    if (grounded && speed > .4 && !dead && !climbing) {
      this.stepDistance += dt * speed;
      // Ground covered between footfalls, walking, running and sprinting. A
      // horse's hooves fall closer together for the ground it covers.
      const gait = /sprint/.test(state) ? 2 : /walk/.test(state) ? 0 : 1;
      const stride = (locomotion.mounted ? [1.5, 2, 2.6] : [1.45, 1.95, 2.5])[gait];
      if (this.stepDistance >= stride) {
        this.stepDistance %= stride;
        this.play(footstepSurface(surface, locomotion.mounted), { volume: gait === 2 ? .9 : .6, rate: .6 + this.random() * .1 });
      }
    } else this.stepDistance = 0;
    this.climbTimer -= dt;
    if (climbing && this.climbTimer <= 0) { this.play('climb', { volume: .65 }); this.climbTimer = .48; }
    // Breath is heard only as stamina is about to run out, and until it comes back.
    const exertion = !dead && (locomotion.exhausted || locomotion.stamina < .3) ? .8 : 0;
    this.breathLevel += (exertion - this.breathLevel) * (1 - Math.exp(-dt / (exertion ? 1 : 5)));
    const levels = { wind: /forest/.test(biomeName) ? .35 : .55, birds: /forest|meadow|plains/.test(biomeName) ? .48 : .14,
      water: /water|lake|river/.test(biomeName) ? .7 : 0, fire: 0, market: 0 };
    for (const name of ['water', 'fire', 'market']) if (environment[name] != null) levels[name] = clamp(environment[name]);
    if (environment.settlement != null) levels.market = Math.max(levels.market, clamp(environment.settlement));
    const positions = {}, strengths = { blacksmith: clamp(environment.blacksmith || 0), animals: clamp(environment.animals || 0) };
    for (const source of environment.sources || []) {
      const type = source.type;
      if (!source.position) continue;
      const distance = Math.hypot(source.position.x - this.listenerPosition.x, (source.position.y || 0) - (this.listenerPosition.y || 0), source.position.z - this.listenerPosition.z);
      const strength = clamp((source.strength ?? 1) * (1 - distance / (source.radius || 45)));
      if (strength > (levels[type] || strengths[type] || 0)) {
        if (type in strengths) strengths[type] = strength; else if (type in levels) levels[type] = strength;
        positions[type] = source.position;
      }
    }
    for (const name of ['wind', 'birds', 'water', 'fire', 'market']) this.loop(name, levels[name], dt, positions[name]);
    this.loop('breathing', this.breathLevel, dt);
    this.smithTimer -= dt; this.animalTimer -= dt;
    if (this.smithTimer <= 0) { if (strengths.blacksmith > .01) this.play('blacksmith', { position: positions.blacksmith, volume: strengths.blacksmith }); this.smithTimer = 1.4 + this.random() * .6; }
    if (this.animalTimer <= 0) { if (strengths.animals > .01) this.play('animals', { position: positions.animals, volume: strengths.animals }); this.animalTimer = 10 + this.random() * 12; }
    for (const name of ['blacksmith', 'animals']) if (strengths[name] > .01) this.load(AUDIO_ASSETS[name].files[0]);
    this.victoryRemaining = Math.max(0, this.victoryRemaining - dt);
    this.combatRemaining = Math.max(0, this.combatRemaining - dt);
    const threat = environment.threat?.toLowerCase?.();
    if (threat === 'combat') { this.combatRemaining = 2.5; this.victoryRemaining = 0; this.setMusicState('combat'); }
    else if (threat === 'victory' && this.musicState !== 'victory') this.setMusicState('victory');
    else if (this.victoryRemaining > 0) this.setMusicState('victory');
    else if (threat && this.combatRemaining <= 0) this.setMusicState(threat === 'suspicion' ? 'suspicion' : 'exploration');
    else if (this.musicState === 'victory' && this.victoryRemaining <= 0) this.setMusicState('exploration');
    for (const stateName of MUSIC_STATES) this.loop(`music${stateName[0].toUpperCase()}${stateName.slice(1)}`, this.musicState === stateName ? 1 : 0, dt);
  }
  footstep(surface, volume = .7, mounted = false) { return this.play(footstepSurface(surface, mounted), { volume }); }
  bird() { return this.play('birds', { volume: .25 }); }
  getStats() {
    return { enabled: this.enabled, paused: this.paused, state: this.context?.state || 'locked', format: this.format, loaded: this.buffers.size,
      loading: this.pending.size, failed: [...this.failed], voices: this.voices.size, loops: this.loops.size,
      musicState: this.musicState, played: this.played, volumes: { ...this.volumes } };
  }
  stopAll() { for (const voice of this.voices) this.stopVoice(voice); this.loops.clear(); }
  release() {
    this.generation++; this.abort?.abort();
    for (const task of this.queue) task.resolve(null);
    this.queue.length = 0; this.downloads = 0; this.pending.clear(); this.buffers.clear(); this.failed.clear(); this.stopAll();
    this.master?.disconnect(); for (const bus of Object.values(this.buses)) bus.disconnect();
    this.master = null; this.buses = {}; this.lastEvent.clear(); this.initializedMotion = false;
  }
  dispose() { if (!this.disposed) { this.disposed = true; this.release(); this.context = null; } }
}

export { GameAudio as AmbientAudio };
