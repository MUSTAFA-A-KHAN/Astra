export class LoadingManager {
  constructor({ element = null, textElement = null } = {}) {
    this.element = element;
    this.textElement = textElement;
    this.active = new Map();
  }

  begin(key, label = 'Loading…') {
    this.active.set(key, { progress: 0, label });
    this.render();
  }

  update(key, progress, label) {
    const item = this.active.get(key);
    if (!item) return;
    item.progress = Math.max(0, Math.min(1, progress));
    if (label) item.label = label;
    this.render();
  }

  end(key) {
    this.active.delete(key);
    this.render();
  }

  render() {
    if (!this.element && !this.textElement) return;
    const items = [...this.active.values()];
    const progress = items.length ? items.reduce((sum, item) => sum + item.progress, 0) / items.length : 1;
    if (this.element) this.element.style.setProperty('--asset-progress', String(progress * 100));
    if (this.textElement) this.textElement.textContent = items[0]?.label || '';
  }
}
