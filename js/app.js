import { WorldData } from './data-store.js';
import { MapEngine } from './map-engine.js';
import { TimelineController } from './timeline.js';

class ErallonAtlas {
  constructor() {
    this.initialState = this._readAddressState();
    this.map = null;
    this.timeline = new TimelineController({
      onChange: (year, epoch, record) => {
        this.map?.render(year, record);
        this._populateLayerCounts(year);
        this._populateSearchOptions(year);
        if (this.map) this._writeAddressState(this.map.getViewState(), year);
      },
    });

    if (Number.isFinite(this.initialState?.year)) this.timeline.setYear(this.initialState.year, { emit: false });
    this.map = new MapEngine({ onViewChange: state => this._writeAddressState(state, this.timeline.getCurrentYear()) });
    this._bindControls();
    this._populateLayerCounts(this.timeline.getCurrentYear());
    this._populateSearchOptions(this.timeline.getCurrentYear());
    this.map.render(this.timeline.getCurrentYear(), this.timeline.getCurrentRecord());
    this._restoreAddressState();
  }

  _bindControls() {
    document.querySelectorAll('[data-marker-filter]').forEach(input => {
      input.addEventListener('change', () => this.map.setMarkerFilter(input.dataset.markerFilter, input.checked));
    });
    document.querySelectorAll('[data-feature-filter]').forEach(input => {
      input.addEventListener('change', () => this.map.setFeatureFilter(input.dataset.featureFilter, input.checked));
    });

    document.getElementById('btn-reset')?.addEventListener('click', () => this.map.fitWorld());
    document.getElementById('layers-toggle')?.addEventListener('click', event => {
      const button = event.currentTarget;
      const panel = button.closest('.layer-panel');
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      button.setAttribute('aria-label', expanded ? 'Развернуть слои' : 'Свернуть слои');
      panel?.classList.toggle('is-collapsed', expanded);
      button.textContent = expanded ? '⌄' : '⌃';
    });

    const search = document.getElementById('location-search');
    search?.addEventListener('input', () => this.map.search(search.value));
    search?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.map.focusLocation(search.value);
      }
      if (event.key === 'Escape') {
        search.value = '';
        this.map.search('');
        search.blur();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key.toLowerCase() === 'r') this.map.fitWorld();
      if (event.key === '+' || event.key === '=') this.map.map.zoomIn();
      if (event.key === '-' || event.key === '_') this.map.map.zoomOut();
    });
  }

  _populateLayerCounts(year = this.timeline.getCurrentYear()) {
    const counts = WorldData.locations
      .filter(location => location.foundedYear <= year)
      .reduce((result, item) => {
        const category = item.floodYear != null && year >= item.floodYear && item.type !== 'anomaly' ? 'ruin' : item.type;
        result[category] = (result[category] || 0) + 1;
        return result;
      }, {});
    document.querySelectorAll('[data-count-for]').forEach(element => {
      element.textContent = String(counts[element.dataset.countFor] || 0).padStart(2, '0');
    });
  }

  _populateSearchOptions(year = this.timeline.getCurrentYear()) {
    const list = document.getElementById('location-suggestions');
    if (!list) return;
    const fragment = document.createDocumentFragment();
    WorldData.locations.filter(item => item.foundedYear <= year).forEach(item => {
      const option = document.createElement('option');
      option.value = item.name;
      option.label = item.region;
      fragment.append(option);
    });
    list.replaceChildren(fragment);
  }

  _readAddressState() {
    const parts = window.location.hash.replace(/^#/, '').split('/').map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(value => !Number.isFinite(value))) return null;
    const [zoom, y, x, year] = parts;
    return { zoom, y, x, year: Number.isFinite(year) ? year : null };
  }

  _restoreAddressState() {
    this.map.ready.then(() => {
      if (this.initialState && [this.initialState.x, this.initialState.y, this.initialState.zoom].every(Number.isFinite)) {
        this.map.restoreView(this.initialState);
      } else {
        this.map.fitWorld();
      }
    });
  }

  _writeAddressState(view, year) {
    if (!view || !Number.isFinite(year)) return;
    const hash = `#${view.zoom.toFixed(2)}/${Math.round(view.y)}/${Math.round(view.x)}/${year}`;
    const next = `${window.location.pathname}${window.location.search}${hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) {
      window.history.replaceState(null, '', next);
    }
  }
}

function startAtlas() {
  if (window.erallonAtlas) return;
  try {
    window.erallonAtlas = new ErallonAtlas();
  } catch (error) {
    console.error('Atlas initialization failed:', error);
    const notice = document.getElementById('map-notice');
    if (notice) {
      notice.textContent = error instanceof Error ? error.message : 'Не удалось запустить картографический атлас.';
      notice.hidden = false;
    }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startAtlas, { once: true });
else startAtlas();