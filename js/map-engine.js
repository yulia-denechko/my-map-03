import { WorldData, periodForYear } from './data-store.js';
import {
  WorldState,
  activeWarsForYear,
  burnProgressForYear,
  floodStateForYear,
  politicalEraForYear,
} from './world-state.js';

const MARKERS = {
  city: { glyph: '♛', icon: 'city.svg', label: 'Город' },
  citadel: { glyph: '♜', icon: 'city.svg', label: 'Цитадель' },
  settlement: { glyph: '•', label: 'Поселение' },
  port: { glyph: '⌁', icon: 'port.svg', label: 'Порт' },
  ruin: { glyph: '◇', icon: 'ruins.svg', label: 'Руины' },
  anomaly: { glyph: '✧', label: 'Аномалия' },
};

const PANE_ORDER = {
  floodZones: 325,
  burnScars: 350,
  warFronts: 370,
  borders: 380,
  landRoutes: 405,
  seaRoutes: 410,
  rivers: 425,
};

const clamp01 = value => Math.max(0, Math.min(1, value));
const smoothstep = value => {
  const progress = clamp01(value);
  return progress * progress * (3 - 2 * progress);
};
const toLatLngs = points => points.map(([x, y]) => [y, x]);
const scalePoints = (points, scale) => {
  const center = points.reduce((sum, [x, y]) => [sum[0] + x / points.length, sum[1] + y / points.length], [0, 0]);
  return points.map(([x, y]) => [center[0] + (x - center[0]) * scale, center[1] + (y - center[1]) * scale]);
};
const yearText = year => year < 0 ? `${Math.abs(year)} год до н.э.` : year === 0 ? 'Год 0' : `${year} год`;
const resampleRing = (points, count) => Array.from({ length: count }, (_, index) => {
  const position = (index / count) * points.length;
  const start = Math.floor(position);
  const progress = position - start;
  const a = points[start % points.length];
  const b = points[(start + 1) % points.length];
  return [a[0] + (b[0] - a[0]) * progress, a[1] + (b[1] - a[1]) * progress];
});

export class MapEngine {
  constructor({ container = 'map', onViewChange = () => {} } = {}) {
    if (!window.L) throw new Error('Leaflet не загружен. Проверьте подключение Leaflet в index.html.');

    this.L = window.L;
    this.containerId = container;
    this.container = document.getElementById(container);
    if (!this.container) throw new Error(`Контейнер карты #${container} не найден.`);

    this.currentYear = -250;
    this.currentPeriod = periodForYear(this.currentYear);
    this.currentRecord = null;
    this.currentPoliticalEraId = null;
    this.searchQuery = '';
    this.markerFilters = new Map(Object.keys(MARKERS).map(type => [type, true]));
    this.featureVisibility = new Map([
      ...Object.keys(WorldData.features).map(name => [name, true]),
      ['floodZones', true],
      ['burnScars', true],
    ]);
    this.markers = new Map();
    this.featureGroups = new Map();
    this.floodLayers = new Map();
    this.burnLayers = new Map();
    this.borderLayers = [];
    this.warFrontGroup = null;
    this.routeLines = { land: [], sea: [], rivers: [] };
    this.onViewChange = onViewChange;
    this._readyResolver = null;
    this.ready = new Promise(resolve => { this._readyResolver = resolve; });

    this._createMap();
    this._createGeographicLayers();
    this._createDynamicLayers();
    this._createLocationMarkers();
    this._bindMapEvents();
    this._loadMapAssets();
  }

  _createMap() {
    const L = this.L;
    this.map = L.map(this.container, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 3,
      zoomSnap: 0.1,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 100,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
      inertia: true,
      inertiaDeceleration: 2800,
      worldCopyJump: false,
    });

    this.map.createPane('atlasBasemap');
    this.map.getPane('atlasBasemap').style.zIndex = '250';
    Object.entries(PANE_ORDER).forEach(([name, zIndex]) => {
      this.map.createPane(name);
      this.map.getPane(name).style.zIndex = String(zIndex);
    });

    this.L.control.zoom({ position: 'topleft' }).addTo(this.map);
    this.baseBounds = WorldData.map.bounds;
    this.map.fitBounds(this.baseBounds, { animate: false });
  }

  _createGeographicLayers() {
    Object.keys(WorldData.features).forEach(name => {
      if (name === 'borders') return;
      const group = this.L.featureGroup();
      this.featureGroups.set(name, group);
      const entries = WorldData.features[name] || [];
      entries.forEach(feature => {
        const line = this.L.polyline(toLatLngs(feature.points), this._featureStyle(name)).addTo(group);
        line.bindTooltip(feature.name, {
          className: 'atlas-feature-label',
          direction: 'top',
          sticky: true,
        });
        if (name === 'landRoutes') this.routeLines.land.push(line);
        if (name === 'seaRoutes') this.routeLines.sea.push(line);
        if (name === 'rivers') this.routeLines.rivers.push(line);
      });
      group.addTo(this.map);
    });

    const borderGroup = this.L.featureGroup();
    this.featureGroups.set('borders', borderGroup);
    borderGroup.addTo(this.map);
  }

  _createDynamicLayers() {
    WorldState.floodZones.forEach(zone => {
      const layer = this.L.polygon(toLatLngs(scalePoints(zone.points, 0.08)), {
        pane: 'floodZones',
        color: '#a3c8c3',
        weight: 2,
        opacity: 0,
        fillColor: '#2b7781',
        fillOpacity: 0,
        lineJoin: 'round',
        interactive: true,
      }).addTo(this.map);
      layer.bindTooltip(`${zone.name} · вода прибывает постепенно`, {
        className: 'atlas-feature-label atlas-water-label',
        sticky: true,
      });
      this.floodLayers.set(zone.id, layer);
    });

    WorldState.burnScars.forEach(scar => {
      const layer = this.L.polygon(toLatLngs(scar.points), {
        pane: 'burnScars',
        color: '#c27658',
        weight: 2,
        opacity: 0,
        fillColor: '#6b3025',
        fillOpacity: 0,
        dashArray: '6 5',
        lineJoin: 'round',
        interactive: true,
      }).addTo(this.map);
      layer.bindTooltip(scar.name, {
        className: 'atlas-feature-label atlas-burn-label',
        sticky: true,
      });
      this.burnLayers.set(scar.id, layer);
    });

    this.warFrontGroup = this.L.featureGroup().addTo(this.map);
  }

  _featureStyle(name) {
    const styles = {
      rivers: { pane: 'rivers', color: '#609297', weight: 4.5, opacity: 0.86, lineCap: 'round', lineJoin: 'round' },
      landRoutes: { pane: 'landRoutes', color: '#a18451', weight: 3, opacity: 0.88, dashArray: '2 8', lineCap: 'round', lineJoin: 'round' },
      seaRoutes: { pane: 'seaRoutes', color: '#88afb0', weight: 3.5, opacity: 0, dashArray: '12 9', lineCap: 'round', lineJoin: 'round' },
    };
    return styles[name] || {};
  }

  _createLocationMarkers() {
    WorldData.locations.forEach(location => {
      const marker = this.L.marker([location.y, location.x], {
        icon: this._markerIcon(location.type),
        title: location.name,
        alt: `${MARKERS[location.type]?.label || 'Место'}: ${location.name}`,
        keyboard: true,
        riseOnHover: true,
        bubblingMouseEvents: false,
      }).addTo(this.map);

      marker.bindTooltip(location.name, {
        permanent: true,
        direction: 'top',
        offset: [0, -34],
        className: 'atlas-location-label',
      });
      marker.bindPopup(() => this._popupContent(location), {
        className: 'lore-popup',
        maxWidth: 360,
        minWidth: 245,
        autoPanPadding: [30, 45],
        closeButton: true,
      });
      marker.on('popupopen', () => { this.activePopupId = location.id; });
      marker.on('popupclose', () => {
        if (this.activePopupId === location.id) this.activePopupId = null;
      });
      this.markers.set(location.id, { marker, location, effectiveType: location.type });
    });
    this._applyMarkerFilters();
  }

  _markerIcon(type) {
    const { glyph, icon, label } = MARKERS[type] || MARKERS.city;
    const artwork = icon ? `<img src="assets/icons/${icon}" alt="" draggable="false">` : `<i>${glyph}</i>`;
    const html = `<span class="atlas-marker atlas-marker--${type}" role="img" aria-label="${label}">${artwork}</span>`;
    return this.L.divIcon({
      className: 'atlas-leaflet-marker',
      html,
      iconSize: [36, 43],
      iconAnchor: [18, 39],
      popupAnchor: [0, -36],
      tooltipAnchor: [0, -33],
    });
  }

  _locationStatus(location) {
    if (location.foundedYear > this.currentYear) return { known: false, type: location.type, label: 'Ещё не основано' };
    if (location.floodYear != null && this.currentYear >= location.floodYear) {
      return { known: true, type: location.type === 'anomaly' ? 'anomaly' : 'ruin', label: `Затоплено в ${yearText(location.floodYear)}` };
    }
    return { known: true, type: location.type, label: `Основано: ${yearText(location.foundedYear)}` };
  }

  _popupContent(location) {
    const story = location.history?.[this.currentPeriod] || location.history?.before;
    const status = this._locationStatus(location);
    const card = document.createElement('article');
    card.className = 'lore-card';

    const metadata = document.createElement('div');
    metadata.className = 'lore-card-header';
    const type = document.createElement('span');
    type.textContent = MARKERS[status.type]?.label || 'Место';
    const region = document.createElement('span');
    region.textContent = `· ${location.region}`;
    metadata.append(type, region);

    const title = document.createElement('h3');
    title.textContent = story?.title || location.name;
    const tag = document.createElement('span');
    tag.className = 'lore-tag';
    tag.textContent = status.label;
    const description = document.createElement('p');
    const baseText = story?.description || 'Летописец ещё не описал это место.';
    description.textContent = `${baseText} Поселение возникло у источника «${location.waterSource}», рядом с ресурсом — ${location.nearbyForest}.`;
    const coordinates = document.createElement('div');
    coordinates.className = 'lore-coordinates';
    coordinates.textContent = `СЕТКА ЭРАЛОНА · ${location.x} / ${location.y}`;

    card.append(metadata, title, tag, description, coordinates);
    return card;
  }

  _bindMapEvents() {
    this.map.on('moveend zoomend', () => this.onViewChange(this.getViewState()));
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.map.invalidateSize({ pan: false }));
      this.resizeObserver.observe(this.container);
    } else {
      window.addEventListener('resize', this._resizeHandler = () => this.map.invalidateSize({ pan: false }));
    }
  }

  _loadMapAssets() {
    const image = new Image();
    image.onload = () => {
      this.baseBounds = [[0, 0], [image.naturalHeight, image.naturalWidth]];
      this.mapBefore = this.L.imageOverlay('assets/maps/map-before.svg', this.baseBounds, {
        pane: 'atlasBasemap',
        interactive: false,
        className: 'atlas-image atlas-image--before',
      }).addTo(this.map);
      this.mapAfter = this.L.imageOverlay('assets/maps/map-after.svg', this.baseBounds, {
        pane: 'atlasBasemap',
        opacity: 0,
        interactive: false,
        className: 'atlas-image atlas-image--after',
      }).addTo(this.map);
      this.mapAfter.on('error', () => this._showNotice('Карта после катаклизма не загрузилась. Проверьте assets/maps/map-after.svg.'));
      this.map.fitBounds(this.baseBounds, { animate: false, paddingTopLeft: [0, 84] });
      this.map.setMaxBounds(this.baseBounds);
      this.map.setMinZoom(this.map.getBoundsZoom(this.baseBounds));
      this.map.whenReady(() => {
        this.map.invalidateSize({ pan: false });
        this._readyResolver(this);
        this.onViewChange(this.getViewState());
      });
      this.render(this.currentYear, this.currentRecord);
    };
    image.onerror = () => {
      this._showNotice('Не удалось загрузить основную карту. Проверьте адрес assets/maps/map-before.svg.');
      this.map.fitBounds(this.baseBounds, { animate: false });
      this._readyResolver(this);
    };
    image.src = 'assets/maps/map-before.svg';
  }

  _showNotice(message) {
    const notice = document.getElementById('map-notice');
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = false;
  }

  _applyMarkerFilters() {
    this.markers.forEach(({ marker, location, effectiveType }) => {
      const status = this._locationStatus(location);
      const categoryEnabled = this.markerFilters.get(status.type) !== false;
      const searchMatches = !this.searchQuery || `${location.name} ${location.region}`.toLocaleLowerCase('ru').includes(this.searchQuery);
      const searchOverride = Boolean(this.searchQuery && searchMatches);
      const visible = status.known && (categoryEnabled || searchOverride);
      const opacity = visible ? (searchMatches ? 1 : 0.14) : 0;
      marker.setOpacity(opacity);
      if (status.type !== effectiveType) {
        marker.setIcon(this._markerIcon(status.type));
        this.markers.get(location.id).effectiveType = status.type;
      }
      marker.setTooltipContent(status.type === 'ruin' ? `${location.name} · руины` : location.name);
      if (visible && searchMatches) marker.openTooltip();
      else marker.closeTooltip();
      const element = marker.getElement();
      if (element) element.style.pointerEvents = visible && searchMatches ? '' : 'none';
    });
  }

  setMarkerFilter(type, enabled) {
    this.markerFilters.set(type, Boolean(enabled));
    this._applyMarkerFilters();
  }

  setFeatureFilter(name, enabled) {
    this.featureVisibility.set(name, Boolean(enabled));
    const group = this.featureGroups.get(name);
    if (group) {
      if (enabled && !this.map.hasLayer(group)) group.addTo(this.map);
      if (!enabled && this.map.hasLayer(group)) this.map.removeLayer(group);
    }
    const layerMap = name === 'floodZones' ? this.floodLayers : name === 'burnScars' ? this.burnLayers : null;
    layerMap?.forEach(layer => {
      const visible = enabled;
      if (visible && !this.map.hasLayer(layer)) layer.addTo(this.map);
      if (!visible && this.map.hasLayer(layer)) this.map.removeLayer(layer);
    });
    if (name === 'burnScars' && this.warFrontGroup) {
      const showFronts = Boolean(enabled && activeWarsForYear(this.currentYear).length);
      if (showFronts && !this.map.hasLayer(this.warFrontGroup)) this.warFrontGroup.addTo(this.map);
      if (!showFronts && this.map.hasLayer(this.warFrontGroup)) this.map.removeLayer(this.warFrontGroup);
    }
  }

  search(query) {
    this.searchQuery = String(query || '').trim().toLocaleLowerCase('ru');
    this._applyMarkerFilters();
    if (!this.searchQuery) return [];
    return WorldData.locations.filter(location => location.foundedYear <= this.currentYear
      && `${location.name} ${location.region}`.toLocaleLowerCase('ru').includes(this.searchQuery));
  }

  focusLocation(query) {
    const normalized = String(query || '').trim().toLocaleLowerCase('ru');
    if (!normalized) return false;
    const matches = WorldData.locations.filter(location => location.foundedYear <= this.currentYear
      && `${location.name} ${location.region}`.toLocaleLowerCase('ru').includes(normalized));
    const result = matches.find(location => location.name.toLocaleLowerCase('ru') === normalized)
      || matches.find(location => location.name.toLocaleLowerCase('ru').startsWith(normalized))
      || matches[0];
    if (!result) return false;

    const entry = this.markers.get(result.id);
    if (entry) {
      this.map.flyTo([result.y, result.x], Math.max(this.map.getZoom(), 0.6), { duration: 0.7 });
      entry.marker.openPopup();
    }
    return true;
  }

  _renderFloodZones(year, water) {
    water.zones.forEach(zone => {
      const layer = this.floodLayers.get(zone.id);
      if (!layer) return;
      const stage = zone.progress;
      const scale = 0.055 + 0.945 * stage;
      const visible = stage > 0.002 && this.featureVisibility.get('floodZones') !== false;
      layer.setLatLngs(toLatLngs(scalePoints(zone.points, scale)));
      layer.setStyle({
        opacity: visible ? 0.25 + stage * 0.68 : 0,
        fillOpacity: visible ? 0.035 + stage * 0.48 : 0,
        weight: 1.2 + stage * 2.2,
        dashArray: stage < 0.16 ? '3 7' : stage < 0.72 ? '7 5' : null,
      });
      if (visible && !this.map.hasLayer(layer)) layer.addTo(this.map);
      if (!visible && this.map.hasLayer(layer)) this.map.removeLayer(layer);
    });
  }

  _renderBurnScars(year) {
    WorldState.burnScars.forEach(scar => {
      const layer = this.burnLayers.get(scar.id);
      if (!layer) return;
      const intensity = burnProgressForYear(scar, year);
      const visible = intensity > 0.015 && this.featureVisibility.get('burnScars') !== false;
      layer.setStyle({
        opacity: visible ? 0.2 + intensity * 0.78 : 0,
        fillOpacity: visible ? intensity * 0.48 : 0,
        weight: 1.4 + intensity * 1.5,
      });
      if (visible && !this.map.hasLayer(layer)) layer.addTo(this.map);
      if (!visible && this.map.hasLayer(layer)) this.map.removeLayer(layer);
    });

    if (!this.warFrontGroup) return;
    this.warFrontGroup.clearLayers();
    const activeWars = this.featureVisibility.get('burnScars') === false ? [] : activeWarsForYear(year);
    activeWars.forEach(war => {
      const [x, y] = war.front;
      this.L.circleMarker([y, x], { pane: 'warFronts', radius: 8, color: '#f2b18a', weight: 2, fillColor: '#8f3e2d', fillOpacity: 0.9, bubblingMouseEvents: false })
        .bindTooltip(`${war.name} · фронт`, { className: 'atlas-feature-label atlas-burn-label', sticky: true })
        .addTo(this.warFrontGroup);
      this.L.circleMarker([y, x], { pane: 'warFronts', radius: 19, color: '#bd7258', weight: 1, opacity: 0.7, fillOpacity: 0, bubblingMouseEvents: false }).addTo(this.warFrontGroup);
    });
    if (activeWars.length && !this.map.hasLayer(this.warFrontGroup)) this.warFrontGroup.addTo(this.map);
    if (!activeWars.length && this.map.hasLayer(this.warFrontGroup)) this.map.removeLayer(this.warFrontGroup);
  }

  _renderBorders(year, coverage) {
    const eraIndex = WorldState.politicalEras.findIndex(item => item.id === politicalEraForYear(year).id);
    const era = WorldState.politicalEras[eraIndex] || WorldState.politicalEras[0];
    const previousEra = eraIndex > 0 ? WorldState.politicalEras[eraIndex - 1] : null;
    const progress = era.endYear === era.startYear ? 1 : clamp01((year - era.startYear) / (era.endYear - era.startYear));
    const territories = era.territories.map((territory, index) => {
      const previous = previousEra?.territories[index];
      const origin = previous?.points || scalePoints(territory.points, 0.82);
      const count = Math.max(origin.length, territory.points.length);
      const from = resampleRing(origin, count);
      const to = resampleRing(territory.points, count);
      const points = from.map((point, pointIndex) => [
        point[0] + (to[pointIndex][0] - point[0]) * progress,
        point[1] + (to[pointIndex][1] - point[1]) * progress,
      ]);
      return { ...territory, points };
    });
    const group = this.featureGroups.get('borders');
    if (this.currentPoliticalEraId !== era.id) {
      group.clearLayers();
      this.borderLayers = territories.map(territory => {
        const polygon = this.L.polygon(toLatLngs(territory.points), {
          pane: 'borders',
          color: territory.color,
          weight: 2.6,
          opacity: 0.78,
          fillColor: territory.color,
          fillOpacity: 0.045,
          dashArray: '9 7',
          lineJoin: 'round',
        });
        polygon.bindTooltip(territory.name, {
          className: 'atlas-feature-label atlas-border-label',
          sticky: true,
        });
        polygon.addTo(group);
        return polygon;
      });
      this.currentPoliticalEraId = era.id;
    }
    const fade = 1 - coverage * 0.24;
    territories.forEach((territory, index) => {
      this.borderLayers[index]?.setLatLngs(toLatLngs(territory.points));
      this.borderLayers[index]?.setStyle({ color: territory.color, fillColor: territory.color, opacity: fade * 0.78, fillOpacity: 0.035 + fade * 0.018 });
      this.borderLayers[index]?.setTooltipContent(territory.name);
    });
    const enabled = this.featureVisibility.get('borders') !== false;
    if (enabled && !this.map.hasLayer(group)) group.addTo(this.map);
    if (!enabled && this.map.hasLayer(group)) this.map.removeLayer(group);
  }

  _updateRouteEpoch(year, coverage) {
    const landProgress = smoothstep((year - WorldData.map.disasterYear) / 150);
    this.routeLines.land.forEach(line => line.setStyle({ opacity: 0.88 - landProgress * 0.78, weight: 3 - landProgress * 0.6 }));
    this.routeLines.sea.forEach(line => line.setStyle({ opacity: 0.04 + landProgress * 0.88, weight: 2.8 + landProgress * 0.8 }));
    const flowTable = [0.24, 0.59, 0.43, 0.87, 0.36, 0.68, 0.17, 0.74, 0.52];
    const flowIndex = ((year % flowTable.length) + flowTable.length) % flowTable.length;
    const seasonalFlow = flowTable[flowIndex];
    this.routeLines.rivers.forEach(line => line.setStyle({
      opacity: Math.max(0.25, 0.88 - coverage * 0.44),
      weight: 3.5 + seasonalFlow * 2.4 + coverage * 0.7,
    }));
  }

  _refreshOpenPopup() {
    if (!this.activePopupId) return;
    const entry = this.markers.get(this.activePopupId);
    if (entry?.marker.isPopupOpen()) entry.marker.setPopupContent(this._popupContent(entry.location));
  }

  render(year, record = null) {
    if (!Number.isFinite(Number(year))) return;
    this.currentYear = Number(year);
    this.currentPeriod = periodForYear(this.currentYear);
    this.currentRecord = record;
    const water = record?.water || floodStateForYear(this.currentYear);
    const overlayOpacity = 0.96 * smoothstep(this.currentYear / 500);

    if (this.mapAfter) this.mapAfter.setOpacity(overlayOpacity);
    this._renderFloodZones(this.currentYear, water);
    this._renderBurnScars(this.currentYear);
    this._renderBorders(this.currentYear, water.coverage);
    this._updateRouteEpoch(this.currentYear, water.coverage);
    this._applyMarkerFilters();
    this._refreshOpenPopup();
  }

  fitWorld() {
    if (this.baseBounds) this.map.fitBounds(this.baseBounds, { animate: true, duration: 0.55 });
  }

  getViewState() {
    const center = this.map.getCenter();
    return { x: center.lng, y: center.lat, zoom: this.map.getZoom() };
  }

  restoreView({ x, y, zoom }) {
    if (![x, y, zoom].every(Number.isFinite)) return;
    this.map.setView([y, x], Math.max(this.map.getMinZoom(), Math.min(this.map.getMaxZoom(), zoom)), { animate: false });
  }

  destroy() {
    this.resizeObserver?.disconnect();
    if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
    this.map.remove();
  }
}