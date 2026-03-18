import 'ol/ol.css';
import './style.css';

import OLMap from 'ol/Map';
import View from 'ol/View';
import Overlay from 'ol/Overlay';

import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';

import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import VectorSource from 'ol/source/Vector';

import GeoJSON from 'ol/format/GeoJSON';

import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import { fromLonLat, toLonLat } from 'ol/proj';

import { Style, Fill, Stroke, Text } from 'ol/style';
import Icon from 'ol/style/Icon';
import CircleStyle from 'ol/style/Circle';

import Draw from 'ol/interaction/Draw';
import Geolocation from 'ol/Geolocation';
import { getArea, getLength, getDistance } from 'ol/sphere';

import {
  createEmpty as extentCreateEmpty,
  extend as extentExtend,
  getCenter as extentGetCenter,
  isEmpty as extentIsEmpty,
} from 'ol/extent';

const BASE_URL = import.meta.env.BASE_URL;

let hoveredGolfFeature = null;
let hoveredRouteIdx = null;
let lastNearest = [];
let activeMeasureInteraction = null;
let activeMeasureType = null;
let legendVisible = false;

const MM_TO_PX = 3.7795275591;
const qgisMm = (mm) => mm * MM_TO_PX;

const styleCache = new window.Map();
const pointIconCache = new window.Map();
const labelStyleCache = new window.Map();
const iconStyleCache = new window.Map();
const iconHoverStyleCache = new window.Map();

function rgbaFromHex(hex, alpha = 1) {
  const h = hex.replace('#', '');
  const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makeStyleKey(parts) {
  return JSON.stringify(parts);
}

function getCachedStyle(key, factory) {
  if (styleCache.has(key)) return styleCache.get(key);
  const style = factory();
  styleCache.set(key, style);
  return style;
}

function getCachedIconStyle(key, factory) {
  if (pointIconCache.has(key)) return pointIconCache.get(key);
  const style = factory();
  pointIconCache.set(key, style);
  return style;
}

function norm(s) {
  return (s ?? '')
    .toString()
    .trim()
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function escapeHtml(s) {
  return (s ?? '')
    .toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function asCleanText(v) {
  return (v ?? '').toString().trim();
}

function normalizeUrl(u) {
  const s = asCleanText(u);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function isDetailZoom() {
  return (view.getZoom() ?? 0) >= 15;
}

function btnRecintoStyleFn() {
  if (!isDetailZoom()) return null;
  return getCachedStyle('btnRecinto', () => new Style({
    stroke: null,
    fill: new Fill({ color: rgbaFromHex('#84af96', 0.7) }),
  }));
}

function btnZonasStyleFn() {
  if (!isDetailZoom()) return null;
  return getCachedStyle('btnZonas', () => new Style({
    stroke: null,
    fill: new Fill({ color: rgbaFromHex('#c9ffc5', 0.5) }),
  }));
}

function osmAreaStyleFn(feature) {
  if (!isDetailZoom()) return null;
  const golf = (feature.get('golf') || '').toString().trim().toLowerCase();
  const defs = {
    bunker: { fill: rgbaFromHex('#ffebd1', 1), stroke: { color: '#fdbf6f', width: qgisMm(0.06) } },
    clubhouse: { fill: rgbaFromHex('#b7b7b7', 1), stroke: { color: '#232323', width: qgisMm(0.26) } },
    driving_range: { fill: rgbaFromHex('#ffd279', 1), stroke: { color: '#f6b92d', width: qgisMm(0.26) } },
    fairway: { fill: rgbaFromHex('#c9ffc5', 0.5), stroke: null },
    green: { fill: rgbaFromHex('#bff3bd', 1), stroke: { color: '#33a02c', width: qgisMm(0.26) } },
    lateral_water_hazard: { fill: rgbaFromHex('#a6cee3', 1), stroke: null },
    rough: { fill: rgbaFromHex('#94c995', 1), stroke: null },
    tee: { fill: rgbaFromHex('#f5ff5e', 1), stroke: null },
    water_hazard: { fill: rgbaFromHex('#a6cee3', 1), stroke: null },
  };
  const def = defs[golf];
  if (!def) return null;
  return getCachedStyle(makeStyleKey(['osmArea', golf]), () => new Style({
    stroke: def.stroke ? new Stroke({ color: def.stroke.color, width: def.stroke.width }) : null,
    fill: new Fill({ color: def.fill }),
  }));
}

function osmLineStyleFn(feature) {
  if (!isDetailZoom()) return null;
  const golf = (feature.get('golf') || '').toString().trim().toLowerCase();
  const defs = {
    cartpath: { color: '#fffd8e', width: qgisMm(0.46), lineDash: null },
    hole: { color: '#aaaaaa', width: qgisMm(0.26), lineDash: [10, 8] },
    path: { color: '#ffc127', width: qgisMm(0.66), lineDash: null },
  };
  const def = defs[golf];
  if (!def) return null;
  return getCachedStyle(makeStyleKey(['osmLine', golf]), () => new Style({
    stroke: new Stroke({
      color: def.color,
      width: def.width,
      lineDash: def.lineDash || undefined,
      lineCap: 'round',
      lineJoin: 'round',
    }),
  }));
}

function osmPointStyleFn(feature) {
  if (!isDetailZoom()) return null;
  const golf = (feature.get('golf') || '').toString().trim().toLowerCase();
  const defs = { pin: `${BASE_URL}icons/pin.png`, tee: `${BASE_URL}icons/tee.png` };
  const src = defs[golf];
  if (!src) return null;
  return getCachedIconStyle(makeStyleKey(['osmPoint', golf]), () => new Style({
    image: new Icon({ src, scale: 0.08, anchor: [0.5, 1], anchorXUnits: 'fraction', anchorYUnits: 'fraction' }),
  }));
}

function makeGeoJsonSource(url) {
  return new VectorSource({
    url,
    format: new GeoJSON({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }),
  });
}

function makeVectorLayer({ source, visible = false, style, declutter = false, zIndex = 0 }) {
  const layer = new VectorLayer({ source, visible, style, declutter });
  layer.setZIndex(zIndex);
  return layer;
}

const baseCarto = new TileLayer({
  visible: true,
  source: new XYZ({
    url: 'https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    crossOrigin: 'anonymous',
  }),
});

const baseOSM = new TileLayer({ visible: true, source: new OSM() });
const basePNOA = new TileLayer({
  visible: false,
  source: new XYZ({ url: 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{-y}.jpeg', crossOrigin: 'anonymous' }),
});

function setBaseMap(activeKey) {
  baseCarto.setVisible(activeKey === 'carto');
  baseOSM.setVisible(activeKey === 'osm');
  basePNOA.setVisible(activeKey === 'pnoa');
}

const view = new View({
  center: fromLonLat([-3.7038, 40.4168]),
  zoom: 6.4,
  minZoom: 4,
  maxZoom: 19,
});

const map = new OLMap({
  target: 'map',
  layers: [baseCarto, baseOSM, basePNOA],
  view,
});

function iconScaleForZoom(z) {
  if (z <= 6) return 0.015;
  if (z <= 8) return 0.025;
  if (z <= 10) return 0.035;
  if (z <= 12) return 0.05;
  if (z <= 14) return 0.07;
  return 0.09;
}

function haloRadiusForZoom(z) {
  if (z <= 6) return 10;
  if (z <= 8) return 12;
  if (z <= 10) return 14;
  if (z <= 12) return 16;
  if (z <= 14) return 18;
  return 20;
}

function getGolfIconStyleForZoom(z) {
  const bucket = Math.round(z * 2) / 2;
  if (iconStyleCache.has(bucket)) return iconStyleCache.get(bucket);
  const style = new Style({
    image: new Icon({
      src: `${BASE_URL}icons/golf.png`,
      scale: iconScaleForZoom(bucket),
      anchor: [0.5, 1],
      anchorXUnits: 'fraction',
      anchorYUnits: 'fraction',
    }),
  });
  iconStyleCache.set(bucket, style);
  return style;
}

function getGolfHoverStyleForZoom(z) {
  const bucket = Math.round(z * 2) / 2;
  if (iconHoverStyleCache.has(bucket)) return iconHoverStyleCache.get(bucket);
  const baseScale = iconScaleForZoom(bucket);
  const arr = [
    new Style({
      image: new CircleStyle({
        radius: haloRadiusForZoom(bucket),
        fill: new Fill({ color: 'rgba(255,255,255,0.55)' }),
        stroke: new Stroke({ color: 'rgba(0,0,0,0.25)', width: 1 }),
      }),
      zIndex: 100,
    }),
    new Style({
      image: new Icon({
        src: `${BASE_URL}icons/golf.png`,
        scale: baseScale * 1.15,
        anchor: [0.5, 1],
        anchorXUnits: 'fraction',
        anchorYUnits: 'fraction',
      }),
      zIndex: 101,
    }),
  ];
  iconHoverStyleCache.set(bucket, arr);
  return arr;
}

function golfIconStyleFn(feature) {
  const z = view.getZoom() ?? 0;
  if (feature && hoveredGolfFeature && feature === hoveredGolfFeature) return getGolfHoverStyleForZoom(z);
  return getGolfIconStyleForZoom(z);
}

function getLabelStyle(nombre) {
  if (labelStyleCache.has(nombre)) return labelStyleCache.get(nombre);
  const s = new Style({
    text: new Text({
      text: nombre,
      font: '12px Inter, system-ui, sans-serif',
      fill: new Fill({ color: '#111827' }),
      stroke: new Stroke({ color: '#ffffff', width: 3 }),
      offsetY: 5,
      textAlign: 'center',
      padding: [2, 4, 2, 4],
    }),
  });
  labelStyleCache.set(nombre, s);
  return s;
}

function labelStyleFn(feature) {
  const z = view.getZoom() ?? 0;
  if (z < 13) return null;
  const nombre = (feature.get('nombre') || '').toString().trim();
  if (!nombre) return null;
  return getLabelStyle(nombre);
}

const btnPuntualSource = makeGeoJsonSource(`${BASE_URL}data/rfeg_clubes.geojson`);
const btnPuntualIconsLayer = makeVectorLayer({ source: btnPuntualSource, visible: true, style: golfIconStyleFn, zIndex: 900 });
const btnPuntualLabelsLayer = makeVectorLayer({ source: btnPuntualSource, visible: true, style: labelStyleFn, declutter: true, zIndex: 999 });
const btnRecintoLayer = makeVectorLayer({ source: makeGeoJsonSource(`${BASE_URL}data/BTN_Recinto_CampoGolf.geojson`), visible: false, style: btnRecintoStyleFn, zIndex: 100 });
const btnZonasVerdesLayer = makeVectorLayer({ source: makeGeoJsonSource(`${BASE_URL}data/BTN_ZonasVerdes_CamposGolf_T2.geojson`), visible: false, style: btnZonasStyleFn, zIndex: 200 });
const osmAreaLayer = makeVectorLayer({ source: makeGeoJsonSource(`${BASE_URL}data/OSM_Area.geojson`), visible: false, style: osmAreaStyleFn, zIndex: 300 });
const osmLineLayer = makeVectorLayer({ source: makeGeoJsonSource(`${BASE_URL}data/OSM_Line.geojson`), visible: false, style: osmLineStyleFn, zIndex: 400 });
const osmPointLayer = makeVectorLayer({ source: makeGeoJsonSource(`${BASE_URL}data/OSM_Point.geojson`), visible: false, style: osmPointStyleFn, zIndex: 500 });

map.addLayer(btnPuntualIconsLayer);
map.addLayer(btnPuntualLabelsLayer);
map.addLayer(btnZonasVerdesLayer);
map.addLayer(btnRecintoLayer);
map.addLayer(osmAreaLayer);
map.addLayer(osmLineLayer);
map.addLayer(osmPointLayer);

const popupEl = document.getElementById('popup');
const popupCloser = document.getElementById('popup-closer');
const popupContent = document.getElementById('popup-content');
popupEl.classList.add('modal-card');
popupEl.style.display = 'none';

let modalBackdrop = document.getElementById('modal-backdrop');
if (!modalBackdrop) {
  modalBackdrop = document.createElement('div');
  modalBackdrop.id = 'modal-backdrop';
  modalBackdrop.style.display = 'none';
  document.body.appendChild(modalBackdrop);
}

function closeModal() {
  modalBackdrop.style.display = 'none';
  popupEl.style.display = 'none';
  popupEl.setAttribute('aria-hidden', 'true');
}
function openModal() {
  modalBackdrop.style.display = 'block';
  popupEl.style.display = 'block';
  popupEl.setAttribute('aria-hidden', 'false');
}
modalBackdrop.addEventListener('click', closeModal);
popupCloser.addEventListener('click', (ev) => { ev.preventDefault(); closeModal(); });
window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeModal(); });

const phoneSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.07 21 3 13.93 3 5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.24 1.01l-2.2 2.2Z"/></svg>`;
const mailSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z"/></svg>`;

function renderClubPopup(props) {
  const nombre = asCleanText(props.nombre) || 'Club de golf';
  const telefono = asCleanText(props.telefono);
  const email = asCleanText(props.email);
  const url = normalizeUrl(props.url);
  const imagenMain = normalizeUrl(props.imagen_main);
  return `
    <div style="max-width:520px;">
      <div style="font-size:24px;font-weight:800;line-height:1.12;color:#0f172a;">${escapeHtml(nombre)}</div>
      <div style="margin-top:8px;font-size:14px;color:#64748b;">Ficha resumida del club</div>
      ${imagenMain ? `<img class="popup-hero" src="${escapeHtml(imagenMain)}" alt="Imagen de ${escapeHtml(nombre)}" />` : ''}
      ${telefono ? `<div style="display:flex;align-items:center;gap:10px;margin-top:14px;color:#334155;">${phoneSvg}<span>${escapeHtml(telefono)}</span></div>` : ''}
      ${email ? `<div style="display:flex;align-items:center;gap:10px;margin-top:8px;color:#334155;word-break:break-word;">${mailSvg}<span>${escapeHtml(email)}</span></div>` : ''}
      ${url ? `<div style="margin-top:16px;"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;border-radius:12px;background:#1f7a3f;color:#fff;text-decoration:none;font-weight:700;">Ver ficha técnica en la RFEG</a></div>` : ''}
    </div>`;
}

map.on('pointermove' , (evt) => {
  if (evt.dragging) return;
  const pixel = map.getEventPixel(evt.originalEvent);
  let found = null;
  map.forEachFeatureAtPixel(pixel, (feature, layer) => {
    if (layer === btnPuntualIconsLayer || layer === btnPuntualLabelsLayer) {
      found = feature;
      return true;
    }
    return false;
  }, { hitTolerance: 6 });
  if (found !== hoveredGolfFeature) {
    hoveredGolfFeature = found;
    btnPuntualIconsLayer.changed();
    map.getTargetElement().style.cursor = hoveredGolfFeature ? 'pointer' : '';
  }
});

view.on('change:resolution', () => {
  btnPuntualIconsLayer.changed();
  btnPuntualLabelsLayer.changed();
  btnRecintoLayer.changed();
  btnZonasVerdesLayer.changed();
  osmAreaLayer.changed();
  osmLineLayer.changed();
  osmPointLayer.changed();
});

const provToMunicipios = new window.Map();
const provKeyToDisplay = new window.Map();

function buildProvMunIndexFromGolf() {
  provToMunicipios.clear();
  provKeyToDisplay.clear();
  const feats = btnPuntualSource.getFeatures() || [];
  for (const f of feats) {
    const provRaw = (f.get('provincia') ?? '').toString().trim();
    const munRaw = (f.get('municipio') ?? '').toString().trim();
    if (!provRaw || !munRaw) continue;
    const provKey = norm(provRaw);
    if (!provKeyToDisplay.has(provKey)) provKeyToDisplay.set(provKey, provRaw);
    if (!provToMunicipios.has(provKey)) provToMunicipios.set(provKey, new window.Map());
    provToMunicipios.get(provKey).set(norm(munRaw), munRaw);
  }
}

function extentForGolfFilter({ provincia, municipio }) {
  const provKey = provincia ? norm(provincia) : '';
  const munKey = municipio ? norm(municipio) : '';
  const feats = btnPuntualSource.getFeatures() || [];
  const ext = extentCreateEmpty();
  for (const f of feats) {
    const p = norm(f.get('provincia'));
    const m = norm(f.get('municipio'));
    if (provKey && p !== provKey) continue;
    if (munKey && m !== munKey) continue;
    const g = f.getGeometry();
    if (g) extentExtend(ext, g.getExtent());
  }
  return extentIsEmpty(ext) ? null : ext;
}

const onGolfReady = () => {
  if (btnPuntualSource.getState() === 'ready') buildProvMunIndexFromGolf();
};
onGolfReady();
btnPuntualSource.on('change', onGolfReady);

map.on('singleclick', (evt) => {
  let foundFeature = null;
  let foundLayer = null;
  map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
    foundFeature = feature;
    foundLayer = layer;
    return true;
  }, { hitTolerance: 6 });
  const isGolf = foundFeature && (foundLayer === btnPuntualIconsLayer || foundLayer === btnPuntualLabelsLayer);
  if (!isGolf) return;
  const currentZoom = map.getView().getZoom() ?? 0;
  const geom = foundFeature.getGeometry();
  let center = null;
  if (geom?.getCoordinates) {
    const coords = geom.getCoordinates();
    if (Array.isArray(coords) && typeof coords[0] === 'number') center = coords;
  }
  if (!center && geom?.getExtent) {
    const ext = geom.getExtent();
    center = [(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2];
  }
  if (currentZoom < 16) {
    map.getView().animate({ center: center || map.getView().getCenter(), zoom: 16, duration: 600 });
    return;
  }
  if (center) map.getView().animate({ center, duration: 250 });
  const props = { ...foundFeature.getProperties() };
  delete props.geometry;
  popupContent.innerHTML = renderClubPopup(props);
  openModal();
});

function setupZoomIndicator(mapInstance) {
  const el = document.createElement('div');
  el.className = 'zoom-indicator';
  mapInstance.getTargetElement().appendChild(el);
  const update = () => { el.textContent = `Zoom: ${(mapInstance.getView().getZoom() ?? 0).toFixed(2)}`; };
  update();
  mapInstance.getView().on('change:resolution', update);
}
setupZoomIndicator(map);

function setupMapLegend(mapInstance) {
  const el = document.createElement('div');
  el.className = 'map-legend';
  el.innerHTML = `<img src="/icons/leyenda.png" alt="Leyenda del mapa" />`;
  mapInstance.getTargetElement().appendChild(el);
  return el;
}
const legendEl = setupMapLegend(map);

const bluePinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24"><path fill="#1e88e5" d="M12 2c-3.86 0-7 3.14-7 7c0 5.25 7 13 7 13s7-7.75 7-13c0-3.86-3.14-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>`;
const bluePinUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(bluePinSvg);

const searchMarkerSource = new VectorSource();
const searchMarkerLayer = new VectorLayer({
  source: searchMarkerSource,
  zIndex: 2000,
  style: new Style({ image: new Icon({ src: bluePinUrl, scale: 1, anchor: [0.5, 1], anchorXUnits: 'fraction', anchorYUnits: 'fraction' }) }),
});
map.addLayer(searchMarkerLayer);

const nearestLinksSource = new VectorSource();
const nearestLinksLayer = new VectorLayer({
  source: nearestLinksSource,
  zIndex: 1990,
  style: (f) => {
    const idx = f.get('routeIdx');
    const isHover = hoveredRouteIdx !== null && idx === hoveredRouteIdx;
    return new Style({
      stroke: new Stroke({ color: isHover ? 'rgba(255,235,59,0.95)' : 'rgba(30,136,229,0.85)', width: isHover ? 7 : 5, lineCap: 'round', lineJoin: 'round' }),
      text: new Text({ text: f.get('label') || '', placement: 'line', overflow: true, font: '700 12px Inter, sans-serif', fill: new Fill({ color: isHover ? 'rgba(33,33,33,0.95)' : 'rgba(30,136,229,1)' }), stroke: new Stroke({ color: 'rgba(255,255,255,0.95)', width: 3 }) }),
    });
  },
});
map.addLayer(nearestLinksLayer);

const measureSource = new VectorSource();
const measureLayer = new VectorLayer({
  source: measureSource,
  zIndex: 2100,
  style: new Style({
    stroke: new Stroke({ color: '#0f766e', width: 3, lineDash: [10, 6] }),
    fill: new Fill({ color: 'rgba(15,118,110,0.08)' }),
    image: new CircleStyle({ radius: 6, fill: new Fill({ color: '#0f766e' }), stroke: new Stroke({ color: '#fff', width: 2 }) }),
  }),
});
map.addLayer(measureLayer);

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}
function formatArea(m2) {
  if (!Number.isFinite(m2)) return '—';
  if (m2 < 1000000) return `${Math.round(m2)} m²`;
  return `${(m2 / 1000000).toFixed(2)} km²`;
}
function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const min = Math.round(Math.max(0, seconds) / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
function formatCarSummary(distM, durS) {
  return `${formatDistance(distM)} · ${formatDuration(durS)}`;
}

function clearNearestUI() {
  const nearbyPanel = document.getElementById('nearby-panel');
  const nearbyList = document.getElementById('nearby-list');
  if (nearbyPanel) nearbyPanel.style.display = 'none';
  if (nearbyList) nearbyList.innerHTML = '';
  lastNearest = [];
  hoveredRouteIdx = null;
  nearestLinksSource.clear();
  nearestLinksLayer.changed();
}

function clearSearchResults() {
  searchMarkerSource.clear();
  clearNearestUI();
  closeModal();
}

async function updateNearestClubsFromCoord(coord3857) {
  const nearbyPanel = document.getElementById('nearby-panel');
  const nearbyList = document.getElementById('nearby-list');
  if (!coord3857) return clearNearestUI();
  if (btnPuntualSource.getState() !== 'ready') {
    if (nearbyPanel) nearbyPanel.style.display = 'block';
    if (nearbyList) nearbyList.innerHTML = '<div class="nearby-empty">Cargando datos de clubes…</div>';
    return;
  }
  const originLonLat = toLonLat(coord3857);
  const feats = btnPuntualSource.getFeatures();
  const straight = feats.map((f) => {
    const c = f.getGeometry()?.getCoordinates?.();
    return c ? { feature: f, straightM: getDistance(originLonLat, toLonLat(c)), coord: c } : null;
  }).filter(Boolean).sort((a, b) => a.straightM - b.straightM);

  const candidates = straight.slice(0, 18);
  if (!candidates.length) {
    if (nearbyPanel) nearbyPanel.style.display = 'block';
    if (nearbyList) nearbyList.innerHTML = '<div class="nearby-empty">No se encontraron clubes.</div>';
    return;
  }

  if (nearbyPanel) nearbyPanel.style.display = 'block';
  if (nearbyList) nearbyList.innerHTML = '<div class="nearby-empty">Calculando rutas…</div>';
  nearestLinksSource.clear();

  const coordParts = [`${originLonLat[0]},${originLonLat[1]}`, ...candidates.map((it) => {
    const ll = toLonLat(it.coord);
    return `${ll[0]},${ll[1]}`;
  })];

  let routed;
  try {
    const resp = await fetch('https://router.project-osrm.org/table/v1/driving/' + coordParts.join(';') + '?sources=0&annotations=duration,distance');
    if (!resp.ok) throw new Error('OSRM table error');
    const data = await resp.json();
    const durations = data?.durations?.[0];
    const distances = data?.distances?.[0];
    routed = candidates.map((it, i) => ({ ...it, durS: durations?.[i + 1], roadM: distances?.[i + 1] }))
      .filter((it) => Number.isFinite(it.durS) && Number.isFinite(it.roadM));
    if (!routed.length) throw new Error('sin rutas válidas');
  } catch {
    routed = candidates.map((it) => ({ ...it, roadM: it.straightM, durS: (it.straightM / 1000 / 40) * 3600, fallback: true }));
  }

  routed.sort((a, b) => a.durS - b.durS);
  lastNearest = routed.slice(0, 3).map((it, i) => ({ ...it, rank: i }));

  const coords = [coord3857, ...lastNearest.map((x) => x.coord)].filter(Boolean);
  if (coords.length >= 2) {
    let minX = coords[0][0], minY = coords[0][1], maxX = coords[0][0], maxY = coords[0][1];
    for (const c of coords) {
      minX = Math.min(minX, c[0]); minY = Math.min(minY, c[1]); maxX = Math.max(maxX, c[0]); maxY = Math.max(maxY, c[1]);
    }
    map.getView().fit([minX, minY, maxX, maxY], { padding: [40, 120, 40, 420], duration: 700, maxZoom: 16 });
  }

  if (nearbyList) {
    nearbyList.innerHTML = lastNearest.map((it, idx) => {
      const props = it.feature.getProperties ? it.feature.getProperties() : {};
      const name = (props.name || props.nombre || 'Campo de golf').toString();
      return `<div class="nearby-item" data-idx="${idx}">${escapeHtml(name)} <span class="nearby-dist">(${formatCarSummary(it.roadM, it.durS)})</span></div>`;
    }).join('');
  }

  nearestLinksSource.clear();
  await Promise.all(lastNearest.map(async (it) => {
    try {
      if (it.fallback) throw new Error('fallback');
      const destLonLat = toLonLat(it.coord);
      const resp = await fetch('https://router.project-osrm.org/route/v1/driving/' + `${originLonLat[0]},${originLonLat[1]};${destLonLat[0]},${destLonLat[1]}` + '?overview=full&geometries=geojson');
      if (!resp.ok) throw new Error('OSRM route error');
      const data = await resp.json();
      const coordsLL = data?.routes?.[0]?.geometry?.coordinates;
      if (!Array.isArray(coordsLL) || coordsLL.length < 2) throw new Error('geometría inválida');
      const line = new LineString(coordsLL.map(([lon, lat]) => fromLonLat([lon, lat])));
      const ft = new Feature({ geometry: line });
      ft.set('routeIdx', it.rank);
      ft.set('label', formatCarSummary(it.roadM, it.durS));
      nearestLinksSource.addFeature(ft);
    } catch {
      const ft = new Feature({ geometry: new LineString([coord3857, it.coord]) });
      ft.set('routeIdx', it.rank);
      ft.set('label', formatCarSummary(it.roadM, it.durS));
      nearestLinksSource.addFeature(ft);
    }
  }));
}

function createSearchBox(mapInstance) {
  const container = document.createElement('div');
  container.className = 'search-tools';
  container.innerHTML = `
    <div class="search-box">
      <div class="search-title">Buscar por ubicación</div>
      <div class="search-row">
        <input id="search-input" class="search-input" type="text" placeholder="Escribe una dirección..." autocomplete="off" />
        <button id="btn-locate" class="secondary-btn search-inline-btn" type="button" title="Mi ubicación">◎</button>
        <button id="btn-reset-search" class="secondary-btn search-inline-btn" type="button" title="Reiniciar búsqueda">↺</button>
      </div>
      <div id="search-suggestions" class="search-suggestions" style="display:none;"></div>
      <div id="search-status" class="search-status"></div>
      <div class="search-mode-row">
        <button id="btn-provincia" class="secondary-btn search-mode-btn" type="button">📍 Búsqueda por provincia</button>
        <button id="btn-municipio" class="secondary-btn search-mode-btn" type="button">🏘️ Búsqueda por municipio</button>
      </div>
    <div id="panel-provincia" style="display:none; margin-top:8px;">
      <select id="select-provincia"><option value="" selected>Cargando provincias…</option></select>
      <div id="prov-status" class="search-status"></div>
    </div>
    <div id="panel-municipio" style="display:none; margin-top:8px;">
      <select id="select-provincia-mun" style="margin-bottom:8px;"><option value="" selected>Cargando provincias…</option></select>
      <select id="select-municipio"><option value="" selected>Selecciona municipio…</option></select>
      <div id="mun-status" class="search-status"></div>
    </div>
    <div id="nearby-panel" class="nearby-panel" style="display:none; margin-top:10px;">
      <div class="nearby-title">Campos más cercanos</div>
      <div id="nearby-list"></div>
    </div>
    </div>
    <div class="zoom-box">
      <div class="zoom-box-title">Nivel de zoom</div>
      <div class="zoom-row">
        <button id="zoom-out-btn" class="zoom-step-btn" type="button">−</button>
        <input id="zoom-slider" class="zoom-slider" type="range" min="4" max="19" step="0.1" value="6.4" />
        <button id="zoom-in-btn" class="zoom-step-btn" type="button">+</button>
      </div>
    </div>
  `;
  mapInstance.getTargetElement().appendChild(container);

  const input = container.querySelector('#search-input');
  const sugBox = container.querySelector('#search-suggestions');
  const status = container.querySelector('#search-status');
  const btnProvincia = container.querySelector('#btn-provincia');
  const btnMunicipio = container.querySelector('#btn-municipio');
  const panelProvincia = container.querySelector('#panel-provincia');
  const panelMunicipio = container.querySelector('#panel-municipio');
  const selectProvincia = container.querySelector('#select-provincia');
  const selectProvinciaMun = container.querySelector('#select-provincia-mun');
  const selectMunicipio = container.querySelector('#select-municipio');
  const provStatus = container.querySelector('#prov-status');
  const munStatus = container.querySelector('#mun-status');
  const nearbyList = container.querySelector('#nearby-list');
  const btnResetSearch = container.querySelector('#btn-reset-search');
  const btnLocate = container.querySelector('#btn-locate');
  const zoomSlider = container.querySelector('#zoom-slider');
  const zoomInBtn = container.querySelector('#zoom-in-btn');
  const zoomOutBtn = container.querySelector('#zoom-out-btn');

  let debounceTimer = null;
  let lastResults = [];

  async function nominatimSearch(q, limit) {
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ format: 'json', q, countrycodes: 'es', limit: String(limit), addressdetails: '1' }).toString();
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Error Nominatim');
    return await res.json();
  }

  function hideSuggestions() {
    sugBox.style.display = 'none';
    sugBox.innerHTML = '';
    lastResults = [];
  }


  function resetSearchUI() {
    input.value = '';
    status.textContent = '';
    provStatus.textContent = '';
    munStatus.textContent = '';
    selectProvincia.value = '';
    selectProvinciaMun.value = '';
    selectMunicipio.innerHTML = '<option value="" selected>Selecciona municipio…</option>';
    searchMarkerSource.clear();
    clearNearestUI();
    hideSuggestions();
    mapInstance.getView().animate({ center: fromLonLat([-3.7038, 40.4168]), zoom: 6.4, duration: 500 });
  }

  const geolocation = new Geolocation({ trackingOptions: { enableHighAccuracy: true }, projection: view.getProjection() });
  geolocation.on('error', () => {
    status.textContent = 'No se pudo obtener la ubicación.';
  });
  geolocation.on('change:position', async () => {
    const pos = geolocation.getPosition();
    if (!pos) return;
    searchMarkerSource.clear();
    searchMarkerSource.addFeature(new Feature(new Point(pos)));
    mapInstance.getView().animate({ center: pos, zoom: 12.5, duration: 500 });
    status.textContent = 'Ubicación centrada';
    geolocation.setTracking(false);
    await updateNearestClubsFromCoord(pos);
  });

  const paintZoomSlider = () => {
    if (!zoomSlider) return;
    const value = parseFloat(zoomSlider.value || '6.4');
    const min = parseFloat(zoomSlider.min || '4');
    const max = parseFloat(zoomSlider.max || '19');
    const pct = ((value - min) / (max - min)) * 100;
    zoomSlider.style.background = `linear-gradient(to right, #c4cad3 0%, #c4cad3 ${pct}%, #ffffff ${pct}%, #ffffff 100%)`;
  };

  const syncZoomSlider = () => {
    if (zoomSlider) {
      zoomSlider.value = String(Math.max(4, Math.min(19, mapInstance.getView().getZoom() ?? 6.4)));
      paintZoomSlider();
    }
  };
  syncZoomSlider();
  mapInstance.getView().on('change:resolution', syncZoomSlider);

  btnResetSearch?.addEventListener('click', resetSearchUI);
  btnLocate?.addEventListener('click', () => {
    status.textContent = 'Buscando tu ubicación…';
    geolocation.setTracking(true);
  });
  zoomInBtn?.addEventListener('click', () => mapInstance.getView().animate({ zoom: Math.min(19, (mapInstance.getView().getZoom() ?? 6.4) + 1), duration: 200 }));
  zoomOutBtn?.addEventListener('click', () => mapInstance.getView().animate({ zoom: Math.max(4, (mapInstance.getView().getZoom() ?? 6.4) - 1), duration: 200 }));
  zoomSlider?.addEventListener('input', () => {
    paintZoomSlider();
    mapInstance.getView().setZoom(parseFloat(zoomSlider.value));
  });

  function showSuggestions(results) {
    lastResults = results;
    if (!results?.length) return hideSuggestions();
    sugBox.innerHTML = results.map((r, idx) => `<div class="search-suggestion" data-idx="${idx}">${escapeHtml((r.display_name || '').toString())}</div>`).join('');
    sugBox.style.display = 'block';
  }

  async function goToResult(r) {
    if (!r) return;
    const lon = parseFloat(r.lon);
    const lat = parseFloat(r.lat);
    const coord = fromLonLat([lon, lat]);
    mapInstance.getView().animate({ center: coord, zoom: 12.5, duration: 450 });
    searchMarkerSource.clear();
    searchMarkerSource.addFeature(new Feature(new Point(coord)));
    await updateNearestClubsFromCoord(coord);
    status.textContent = r.display_name || 'Listo';
    hideSuggestions();
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 3) {
        status.textContent = '';
        hideSuggestions();
        return;
      }
      try {
        showSuggestions(await nominatimSearch(q, 5));
        status.textContent = '';
      } catch {
        hideSuggestions();
        status.textContent = 'No se pudieron cargar sugerencias.';
      }
    }, 250);
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (lastResults.length) {
        goToResult(lastResults[0]);
      }
    } else if (ev.key === 'Escape') {
      hideSuggestions();
    }
  });

  sugBox.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const idx = target.getAttribute('data-idx');
    if (idx === null) return;
    goToResult(lastResults[parseInt(idx, 10)]);
  });

  nearbyList?.addEventListener('mouseover', (ev) => {
    const item = ev.target?.closest?.('.nearby-item');
    if (!item) return;
    const idx = Number(item.getAttribute('data-idx'));
    if (Number.isFinite(idx)) {
      hoveredRouteIdx = idx;
      nearestLinksLayer.changed();
    }
  });
  nearbyList?.addEventListener('mouseleave', () => {
    hoveredRouteIdx = null;
    nearestLinksLayer.changed();
  });
  nearbyList?.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const item = target.closest('.nearby-item');
    if (!item) return;
    const it = lastNearest[parseInt(item.getAttribute('data-idx') || '-1', 10)];
    if (!it) return;
    const center = it.feature.getGeometry()?.getCoordinates?.();
    mapInstance.getView().animate({ center, zoom: 16, duration: 650 });
  });

  function fillProvinciaSelectFromGeoJSON(sel) {
    if (btnPuntualSource.getState() !== 'ready') {
      sel.innerHTML = '<option value="" selected>Cargando provincias…</option>';
      sel.disabled = true;
      return;
    }
    const provincias = Array.from(provKeyToDisplay.values()).sort((a, b) => a.localeCompare(b, 'es'));
    sel.innerHTML = '<option value="" selected>Selecciona provincia…</option>' + provincias.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    sel.disabled = false;
  }
  function refreshProvinciaCombos() {
    fillProvinciaSelectFromGeoJSON(selectProvincia);
    fillProvinciaSelectFromGeoJSON(selectProvinciaMun);
  }
  refreshProvinciaCombos();
  btnPuntualSource.on('change', () => { if (btnPuntualSource.getState() === 'ready') refreshProvinciaCombos(); });

  btnProvincia.addEventListener('click', () => {
    panelProvincia.style.display = panelProvincia.style.display === 'none' ? 'block' : 'none';
    panelMunicipio.style.display = 'none';
  });
  btnMunicipio.addEventListener('click', () => {
    panelMunicipio.style.display = panelMunicipio.style.display === 'none' ? 'block' : 'none';
    panelProvincia.style.display = 'none';
  });

  selectProvincia.addEventListener('change', () => {
    const prov = selectProvincia.value;
    if (!prov) return;
    const extLocal = extentForGolfFilter({ provincia: prov, municipio: null });
    if (!extLocal) {
      provStatus.textContent = 'No se encontraron clubes en esa provincia.';
      return;
    }
    mapInstance.getView().fit(extLocal, { padding: [70, 90, 70, 430], duration: 600, maxZoom: 12 });
    searchMarkerSource.clear();
    searchMarkerSource.addFeature(new Feature(new Point(extentGetCenter(extLocal))));
    clearNearestUI();
    provStatus.textContent = `Mostrando clubes en ${prov}`;
  });

  selectProvinciaMun.addEventListener('change', () => {
    const prov = selectProvinciaMun.value;
    selectMunicipio.innerHTML = '<option value="" selected>Selecciona municipio…</option>';
    if (!prov) return;
    const munMap = provToMunicipios.get(norm(prov));
    if (!munMap?.size) {
      munStatus.textContent = 'No hay municipios con clubes en esa provincia.';
      return;
    }
    const municipios = Array.from(munMap.values()).sort((a, b) => a.localeCompare(b, 'es'));
    selectMunicipio.innerHTML = '<option value="" selected>Selecciona municipio…</option>' + municipios.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    munStatus.textContent = `Municipios disponibles: ${municipios.length}`;
  });

  selectMunicipio.addEventListener('change', () => {
    const prov = selectProvinciaMun.value;
    const mun = selectMunicipio.value;
    if (!prov || !mun) return;
    const ext = extentForGolfFilter({ provincia: prov, municipio: mun });
    if (!ext) {
      munStatus.textContent = 'No se encontraron clubes en ese municipio.';
      return;
    }
    mapInstance.getView().fit(ext, { padding: [70, 90, 70, 430], duration: 600, maxZoom: 15 });
    searchMarkerSource.clear();
    searchMarkerSource.addFeature(new Feature(new Point(extentGetCenter(ext))));
    clearNearestUI();
    munStatus.textContent = `Mostrando clubes en ${mun} (${prov})`;
  });

  input.addEventListener('blur', () => setTimeout(hideSuggestions, 300));
}
createSearchBox(map);


function bindToggle(id, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  onChange(el.checked);
  el.addEventListener('change', () => onChange(el.checked));
}
function bindBasemapSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  const picker = document.getElementById('basemap-picker');
  const pickerBtn = document.getElementById('basemap-picker-btn');
  const pickerMenu = document.getElementById('basemap-picker-menu');
  const currentThumb = document.getElementById('basemap-current-thumb');
  const currentLabel = document.getElementById('basemap-current-label');
  const optionButtons = Array.from(document.querySelectorAll('.basemap-option'));

  const updateBasemapUI = (value) => {
    const nextValue = value || 'carto';
    const matchedOption = optionButtons.find((btn) => btn.dataset.value === nextValue) || optionButtons[0];
    optionButtons.forEach((btn) => {
      const active = btn === matchedOption;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (matchedOption) {
      currentThumb.src = matchedOption.dataset.thumb || `${BASE_URL}icons/carto.png`;
      currentLabel.textContent = matchedOption.dataset.label || matchedOption.textContent?.trim() || 'Carto Positron';
    }
    sel.value = matchedOption?.dataset.value || nextValue;
    setBaseMap(sel.value || 'carto');
  };

  const closePicker = () => {
    picker?.classList.remove('is-open');
    pickerBtn?.setAttribute('aria-expanded', 'false');
  };

  const openPicker = () => {
    picker?.classList.add('is-open');
    pickerBtn?.setAttribute('aria-expanded', 'true');
  };

  updateBasemapUI(sel.value || 'carto');

  sel.addEventListener('change', () => updateBasemapUI(sel.value || 'carto'));

  pickerBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (picker?.classList.contains('is-open')) closePicker();
    else openPicker();
  });

  optionButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      updateBasemapUI(btn.dataset.value || 'carto');
      closePicker();
    });
  });

  document.addEventListener('click', (ev) => {
    if (!picker?.contains(ev.target)) closePicker();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closePicker();
  });
}

function setupLayoutActions() {
  const rightbar = document.getElementById('rightbar');
  const toggleRightbar = document.getElementById('toggle-rightbar');
  const collapseRightbar = document.getElementById('collapse-rightbar');
  const toggleLegendBtn = document.getElementById('toggle-legend');
  const clearResultsBtn = document.getElementById('clear-results');
  const toggleMeasurePanelBtn = document.getElementById('toggle-measure-panel');
  const measurePanel = document.getElementById('measure-panel');
  const btnMeasureLine = document.getElementById('tool-measure-line');
  const btnMeasureArea = document.getElementById('tool-measure-area');
  const btnClearMeasure = document.getElementById('tool-clear-measure');
  const measureStatus = document.getElementById('measure-status');

  const openPanel = () => rightbar?.classList.remove('is-collapsed');
  const closePanel = () => {
    rightbar?.classList.add('is-collapsed');
    legendEl.classList.remove('is-visible');
    measurePanel?.classList.remove('is-visible');
  };

  function setMeasureButtonState(type) {
    [btnMeasureLine, btnMeasureArea].forEach((btn) => btn?.classList.remove('is-active'));
    if (type === 'LineString') btnMeasureLine?.classList.add('is-active');
    if (type === 'Polygon') btnMeasureArea?.classList.add('is-active');
  }
  function updateMeasureStatus(message) {
    if (measureStatus) measureStatus.textContent = message;
  }
  function stopMeasurement() {
    if (activeMeasureInteraction) map.removeInteraction(activeMeasureInteraction);
    activeMeasureInteraction = null;
    activeMeasureType = null;
    setMeasureButtonState(null);
    updateMeasureStatus('Sin medición activa');
  }
  function startMeasurement(type) {
    if (activeMeasureType === type) {
      stopMeasurement();
      return;
    }
    stopMeasurement();
    activeMeasureType = type;
    setMeasureButtonState(type);
    measureSource.clear();
    activeMeasureInteraction = new Draw({ source: measureSource, type });
    map.addInteraction(activeMeasureInteraction);
    updateMeasureStatus(type === 'LineString' ? 'Dibuja una línea para medir distancia' : 'Dibuja un polígono para medir superficie');
    activeMeasureInteraction.on('drawstart', () => measureSource.clear());
    activeMeasureInteraction.on('drawend', (evt) => {
      const geom = evt.feature.getGeometry();
      if (type === 'LineString') updateMeasureStatus(`Distancia: ${formatDistance(getLength(geom))}`);
      else updateMeasureStatus(`Superficie: ${formatArea(getArea(geom))}`);
    });
  }

  toggleRightbar?.addEventListener('click', () => rightbar?.classList.contains('is-collapsed') ? openPanel() : closePanel());
  collapseRightbar?.addEventListener('click', closePanel);
  toggleLegendBtn?.addEventListener('click', () => {
    legendVisible = !legendVisible;
    legendEl.classList.toggle('is-visible', legendVisible);
    toggleLegendBtn.textContent = legendVisible ? '🗺️ Ocultar leyenda' : '🗺️ Mostrar leyenda';
  });
  toggleMeasurePanelBtn?.addEventListener('click', () => {
    const visible = measurePanel?.classList.toggle('is-visible');
    if (toggleMeasurePanelBtn) toggleMeasurePanelBtn.textContent = visible ? '📏 Ocultar medición' : '📏 Herramientas de medición';
  });
  btnMeasureLine?.addEventListener('click', () => startMeasurement('LineString'));
  btnMeasureArea?.addEventListener('click', () => startMeasurement('Polygon'));
  btnClearMeasure?.addEventListener('click', () => {
    measureSource.clear();
    stopMeasurement();
  });
  clearResultsBtn?.addEventListener('click', () => {
    clearSearchResults();
    measureSource.clear();
    stopMeasurement();
  });

  document.querySelectorAll('.group-section').forEach((section) => {
    const btn = section.querySelector('.group-expand-btn');
    btn?.addEventListener('click', () => {
      section.classList.toggle('is-collapsed');
      const expanded = !section.classList.contains('is-collapsed');
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const appState = {
    groupBtn: document.getElementById('chk-group-btn')?.checked ?? true,
    groupOsm: document.getElementById('chk-group-osm')?.checked ?? true,
    btnPuntual: document.getElementById('chk-btn-puntual')?.checked ?? true,
    btnRecinto: document.getElementById('chk-btn-recinto')?.checked ?? true,
    btnZonas: document.getElementById('chk-btn-zonas')?.checked ?? true,
    osmArea: document.getElementById('chk-osm-area')?.checked ?? true,
    osmLine: document.getElementById('chk-osm-line')?.checked ?? true,
    osmPoint: document.getElementById('chk-osm-point')?.checked ?? true,
  };

  const syncLayers = () => {
    btnPuntualIconsLayer.setVisible(appState.groupBtn && appState.btnPuntual);
    btnPuntualLabelsLayer.setVisible(appState.groupBtn && appState.btnPuntual);
    btnRecintoLayer.setVisible(appState.groupBtn && appState.btnRecinto);
    btnZonasVerdesLayer.setVisible(appState.groupBtn && appState.btnZonas);
    osmAreaLayer.setVisible(appState.groupOsm && appState.osmArea);
    osmLineLayer.setVisible(appState.groupOsm && appState.osmLine);
    osmPointLayer.setVisible(appState.groupOsm && appState.osmPoint);
  };

  bindToggle('chk-group-btn', (checked) => { appState.groupBtn = checked; syncLayers(); });
  bindToggle('chk-group-osm', (checked) => { appState.groupOsm = checked; syncLayers(); });
  bindToggle('chk-btn-puntual', (checked) => { appState.btnPuntual = checked; syncLayers(); });
  bindToggle('chk-btn-recinto', (checked) => { appState.btnRecinto = checked; syncLayers(); });
  bindToggle('chk-btn-zonas', (checked) => { appState.btnZonas = checked; syncLayers(); });
  bindToggle('chk-osm-area', (checked) => { appState.osmArea = checked; syncLayers(); });
  bindToggle('chk-osm-line', (checked) => { appState.osmLine = checked; syncLayers(); });
  bindToggle('chk-osm-point', (checked) => { appState.osmPoint = checked; syncLayers(); });
  syncLayers();

  bindBasemapSelect('basemap-select');
  setupLayoutActions();
});
