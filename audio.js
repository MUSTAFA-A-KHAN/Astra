/** Small synthesized environmental sounds. Audio starts only on an existing,
 * user-activated AudioContext; there are no downloads or autoplay attempts. */
export class AmbientAudio {
  constructor({ context = null, enabled = true } = {}) {
    this.context = null; this.enabled = enabled; this.paused = false;
    this.wind = null; this.water = null; this.master = null;
    this.sources = []; this.nodes = []; this.stepDistance = 0;
    this.wasGrounded = true; this.birdTimer = 8; this.disposed = false;
    if (context) this.setContext(context);
  }
  setContext(context) {
    if (this.disposed || !context || this.context === context) return;
    this.release(); this.context = context;
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      previous = (previous + (Math.random() * 2 - 1) * .025) / 1.025;
      data[i] = previous * 5;
    }
    this.noise = buffer;
    this.master = context.createGain(); this.master.gain.value = 0; this.master.connect(context.destination);
    for (const [name, cutoff, rate] of [['wind', 470, .7], ['water', 1800, 1.2]]) {
      const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
      source.buffer = buffer; source.loop = true; source.playbackRate.value = rate;
      filter.type = 'lowpass'; filter.frequency.value = cutoff; gain.gain.value = 0;
      source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start();
      this[name] = gain; this.sources.push(source); this.nodes.push(filter, gain);
    }
  }
  setEnabled(enabled) { this.enabled = !!enabled; this.refreshVolume(); }
  setPaused(paused) { this.paused = !!paused; this.stepDistance = 0; this.refreshVolume(); }
  refreshVolume() {
    if (this.master && this.context?.state !== 'closed') this.master.gain.setTargetAtTime(this.enabled && !this.paused ? .55 : 0, this.context.currentTime, .2);
  }
  update(dt, position, biome, locomotion = {}) {
    const context = this.context;
    if (!context || context.state !== 'running' || this.disposed) return;
    this.refreshVolume();
    if (!this.enabled || this.paused) return;
    const name = typeof biome === 'string' ? biome.toLowerCase() : (biome?.id || biome?.name || 'meadow').toLowerCase();
    const now = context.currentTime;
    const forest = name === 'forest', wet = name === 'river' || name === 'lake';
    this.wind.gain.setTargetAtTime((forest ? .026 : .018) * (1 + Math.sin(now * .17) * .2), now, 1.5);
    this.water.gain.setTargetAtTime(wet ? .045 : .001, now, 1);
    const grounded = locomotion.grounded !== false;
    const speed = locomotion.speed ?? Math.hypot(locomotion.velocity?.x || 0, locomotion.velocity?.z || 0);
    const state = locomotion.state || 'Run';
    if (grounded && !this.wasGrounded) this.footstep(name, .85);
    this.wasGrounded = grounded;
    if (grounded && speed > .4 && state !== 'Dead') {
      this.stepDistance += Math.max(0, dt) * speed;
      const stride = state === 'Walk' ? 1.9 : state === 'Sprint' ? 3.6 : 3.1;
      if (this.stepDistance >= stride) {
        this.stepDistance %= stride;
        this.footstep(locomotion.surface || name, state === 'Sprint' ? .7 : .45);
      }
    } else this.stepDistance = 0;
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 13 + Math.random() * 16;
      if (forest || name === 'meadow' || name === 'plains') this.bird();
    }
  }
  footstep(surface, volume) {
    const context = this.context;
    if (!context || !this.noise || !this.enabled || this.paused || context.state !== 'running') return;
    const rock = /rock|mountain|ruin/i.test(surface), wood = /wood|bridge/i.test(surface), wet = /water|lake|river|mud/i.test(surface);
    const now = context.currentTime;
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.value = wet ? 1800 : rock ? 1600 : wood ? 900 : 520;
    gain.gain.setValueAtTime(volume * (rock ? .16 : .23), now); gain.gain.exponentialRampToValueAtTime(.001, now + (wet ? .15 : .09));
    source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(now, Math.random(), .18);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    if (rock || wood) {
      const impact = context.createOscillator(), body = context.createGain();
      impact.frequency.setValueAtTime(wood ? 135 : 78, now); impact.frequency.exponentialRampToValueAtTime(45, now + .06);
      body.gain.setValueAtTime(.03 * volume, now); body.gain.exponentialRampToValueAtTime(.001, now + .075);
      impact.connect(body); body.connect(this.master); impact.start(); impact.stop(now + .085);
      impact.onended = () => { impact.disconnect(); body.disconnect(); };
    }
  }
  bird() {
    const context = this.context, now = context.currentTime;
    const voice = context.createOscillator(), gain = context.createGain();
    voice.type = 'sine'; voice.frequency.setValueAtTime(1750, now); voice.frequency.exponentialRampToValueAtTime(2800, now + .07);
    voice.frequency.exponentialRampToValueAtTime(1900, now + .16);
    gain.gain.setValueAtTime(.001, now); gain.gain.linearRampToValueAtTime(.013, now + .03); gain.gain.exponentialRampToValueAtTime(.001, now + .18);
    voice.connect(gain); gain.connect(this.master); voice.start(); voice.stop(now + .2);
    voice.onended = () => { voice.disconnect(); gain.disconnect(); };
  }
  release() {
    for (const source of this.sources) { try { source.stop(); } catch {} source.disconnect(); }
    for (const node of this.nodes) node.disconnect();
    this.master?.disconnect(); this.sources.length = 0; this.nodes.length = 0;
    this.master = this.wind = this.water = null; this.noise = null;
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.release(); this.context = null; }
}
