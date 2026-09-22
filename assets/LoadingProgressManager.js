export class LoadingProgressManager {
  constructor(ui = {}) { this.ui = ui; this.entries = new Map(); }
  set(key, progress, message) {
    this.entries.set(key, { progress: Math.max(0, Math.min(1, progress)), message });
    this.render();
  }
  complete(key, message) { this.set(key, 1, message); }
  fail(key, message) { this.entries.set(key, { progress: 1, message, failed: true }); this.render(); }
  render() {
    const values = [...this.entries.values()];
    const progress = values.length ? values.reduce((s, x) => s + x.progress, 0) / values.length : 0;
    if (this.ui.bar) this.ui.bar.style.width = Math.round(progress * 100) + '%';
    const current = values.find(x => x.progress < 1) || values.at(-1);
    if (current && current.message && this.ui.message) this.ui.message.textContent = current.message;
  }
}
