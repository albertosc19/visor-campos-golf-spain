import 'ol/ol.css';
import './style.css';

import OLMap from 'ol/Map';
import View from 'ol/View';

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

import {
  createEmpty as extentCreateEmpty,
  extend as extentExtend,
  getCenter as extentGetCenter,
  isEmpty as extentIsEmpty,
} from 'ol/extent';

import { getDistance } from 'ol/sphere';

// ========================
// Hover state (solo campos de golf puntuales)
// ========================
let hoveredGolfFeature = null;

// ========================
// Estilos temáticos (solo visibles desde zoom >= 16)
// NO tocar rfeg_clubes
// ========================

const MM_TO_PX = 3.7795275591; // aprox. 1 mm a 96 dpi
const qgisMm = (mm) => mm * MM_TO_PX;

const styleCache = new window.Map();
const pointIconCache = new window.Map();

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

function isDetailZoom() {
  return (view.getZoom() ?? 0) >= 15;
}

// BTN recinto
function btnRecintoStyleFn() {
  if (!isDetailZoom()) return null;

  return getCachedStyle('btnRecinto', () => {
    return new Style({
      stroke: null,
      fill: new Fill({
        color: rgbaFromHex('#84af96', 0.70),
      }),
    });
  });
}

// BTN zonas verdes
function btnZonasStyleFn() {
  if (!isDetailZoom()) return null;

  return getCachedStyle('btnZonas', () => {
    return new Style({
      stroke: null,
      fill: new Fill({
        color: rgbaFromHex('#c9ffc5', 0.50),
      }),
    });
  });
}

// OSM Area por atributo golf
function osmAreaStyleFn(feature) {
  if (!isDetailZoom()) return null;

  const golf = (feature.get('golf') || '').toString().trim().toLowerCase();

  const defs = {
    bunker: {
      fill: rgbaFromHex('#ffebd1', 1),
      stroke: { color: '#fdbf6f', width: qgisMm(0.06) },
    },
    clubhouse: {
      fill: rgbaFromHex('#b7b7b7', 1),
      stroke: { color: '#232323', width: qgisMm(0.26) },
    },
    driving_range: {
      fill: rgbaFromHex('#ffd279', 1),
      stroke: { color: '#f6b92d', width: qgisMm(0.26) },
    },
    fairway: {
      fill: rgbaFromHex('#c9ffc5', 0.50),
      stroke: null,
    },
    green: {
      fill: rgbaFromHex('#bff3bd', 1),
      stroke: { color: '#33a02c', width: qgisMm(0.26) },
    },
    lateral_water_hazard: {
      fill: rgbaFromHex('#a6cee3', 1),
      stroke: null,
    },
    rough: {
      fill: rgbaFromHex('#94c995', 1),
      stroke: null,
    },
    tee: {
      fill: rgbaFromHex('#f5ff5e', 1),
      stroke: null,
    },
    water_hazard: {
      fill: rgbaFromHex('#a6cee3', 1),
      stroke: null,
    },
  };

  const def = defs[golf];
  if (!def) return null;

  const key = makeStyleKey(['osmArea', golf]);

  return getCachedStyle(key, () => {
    return new Style({
      stroke: def.stroke
        ? new Stroke({
            color: def.stroke.color,
            width: def.stroke.width,
          })
        : null,
      fill: new Fill({
        color: def.fill,
      }),
    });
  });
}

// OSM Line por atributo golf
function osmLineStyleFn(feature) {
  if (!isDetailZoom()) return null;

  const golf = (feature.get('golf') || '').toString().trim().toLowerCase();

  const defs = {
    cartpath: {
      color: '#fffd8e',
      width: qgisMm(0.46),
      lineDash: null,
    },
    hole: {
      color: '#aaaaaa',
      width: qgisMm(0.26),
      lineDash: [10, 8],
    },
    path: {
      color: '#ffc127',
      width: qgisMm(0.66),
      lineDash: null,
    },
  };

  const def = defs[golf];
  if (!def) return null;

  const key = makeStyleKey(['osmLine', golf]);

  return getCachedStyle(key, () => {
    return new Style({
      stroke: new Stroke({
        color: def.color,
        width: def.width,
        lineDash: def.lineDash || undefined,
        lineCap: 'round',
        lineJoin: 'round',
      }),
    });
  });
}

// OSM Point por atributo golf
function osmPointStyleFn(feature) {
  if (!isDetailZoom()) return null;

  const golf = (feature.get('golf') || '').toString().trim().toLowerCase();

  const defs = {
    pin: '/icons/pin.png',
    tee: '/icons/tee.png',
  };

  const src = defs[golf];
  if (!src) return null;

  const key = makeStyleKey(['osmPoint', golf]);

  return getCachedIconStyle(key, () => {
    return new Style({
      image: new Icon({
        src,
        scale: 0.08,
        anchor: [0.5, 1],
        anchorXUnits: 'fraction',
        anchorYUnits: 'fraction',
      }),
    });
  });
}


// ========================
// Helpers
// ========================

function makeGeoJsonSource(url) {
  return new VectorSource({
    url,
    format: new GeoJSON({
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    }),
  });
}

function makeVectorLayer({ source, visible = false, style, declutter = false, zIndex = 0 }) {
  const layer = new VectorLayer({
    source,
    visible,
    style,
    declutter,
  });
  layer.setZIndex(zIndex);
  return layer;
}

// normaliza strings para comparar (sin tildes, trim, lower)
function norm(s) {
  return (s ?? '')
    .toString()
    .trim()
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// escape básico para evitar que un texto rompa el HTML del popup
function escapeHtml(s) {
  return (s ?? '')
    .toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ========================
// MAPAS BASE (XYZ/TMS)
// ========================

const baseOSM = new TileLayer({
  visible: true,
  source: new OSM(),
});

const basePNOA = new TileLayer({
  visible: false,
  source: new XYZ({
    url: 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{-y}.jpeg',
    crossOrigin: 'anonymous',
  }),
});

const baseMTN50 = new TileLayer({
  visible: false,
  source: new XYZ({
    url: 'https://tms-mapa-raster.ign.es/1.0.0/mapa-raster/{z}/{x}/{-y}.jpeg',
    crossOrigin: 'anonymous',
  }),
});

function setBaseMap(activeKey) {
  baseOSM.setVisible(activeKey === 'osm');
  basePNOA.setVisible(activeKey === 'pnoa');
  baseMTN50.setVisible(activeKey === 'mtn50');
}

// ========================
// Vista + mapa
// ========================

const view = new View({
  center: [-443000, 4865000],
  zoom: 6.2,
});

const map = new OLMap({
  target: 'map',
  layers: [baseOSM, basePNOA, baseMTN50],
  view,
});

// ========================
// Icono dinámico por zoom (cacheado) + hover (halo)
// ========================

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

const iconStyleCache = new window.Map();
const iconHoverStyleCache = new window.Map();

function getGolfIconStyleForZoom(z) {
  const bucket = Math.round(z * 2) / 2;
  if (iconStyleCache.has(bucket)) return iconStyleCache.get(bucket);

  const scale = iconScaleForZoom(bucket);
  const style = new Style({
    image: new Icon({
      src: '/icons/golf.png',
      scale,
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
  const hoverScale = baseScale * 1.15;

  const halo = new Style({
    image: new CircleStyle({
      radius: haloRadiusForZoom(bucket),
      fill: new Fill({ color: 'rgba(255,255,255,0.55)' }),
      stroke: new Stroke({ color: 'rgba(0,0,0,0.25)', width: 1 }),
    }),
    zIndex: 100,
  });

  const icon = new Style({
    image: new Icon({
      src: '/icons/golf.png',
      scale: hoverScale,
      anchor: [0.5, 1],
      anchorXUnits: 'fraction',
      anchorYUnits: 'fraction',
    }),
    zIndex: 101,
  });

  const arr = [halo, icon];
  iconHoverStyleCache.set(bucket, arr);
  return arr;
}

// estilo base para otros puntos (OSM_Point) — sin hover
function iconStyleFn(feature, resolution) {
  const z = view.getZoom() ?? 0;
  return getGolfIconStyleForZoom(z);
}

// estilo SOLO para campos de golf puntuales (con hover)
function golfIconStyleFn(feature, resolution) {
  const z = view.getZoom() ?? 0;
  if (feature && hoveredGolfFeature && feature === hoveredGolfFeature) {
    return getGolfHoverStyleForZoom(z);
  }
  return getGolfIconStyleForZoom(z);
}

// ========================
// Etiquetas (desde zoom >= 13) — SOLO campo "nombre"
// ========================

const labelStyleCache = new window.Map();

function getLabelStyle(nombre) {
  if (labelStyleCache.has(nombre)) return labelStyleCache.get(nombre);

  const s = new Style({
    text: new Text({
      text: nombre,
      font: '12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
      fill: new Fill({ color: '#111' }),
      stroke: new Stroke({ color: '#fff', width: 3 }),
      offsetY: 5,
      textAlign: 'center',
      overflow: false,
      padding: [2, 4, 2, 4],
    }),
  });

  labelStyleCache.set(nombre, s);
  return s;
}

function labelStyleFn(feature, resolution) {
  const z = view.getZoom() ?? 0;
  if (z < 13) return null;

  const nombre = (feature.get('nombre') || '').toString().trim();
  if (!nombre) return null;

  return getLabelStyle(nombre);
}

// ========================
// Capas
// ========================

const btnPuntualSource = makeGeoJsonSource('./data/rfeg_clubes.geojson');

const btnPuntualIconsLayer = makeVectorLayer({
  source: btnPuntualSource,
  visible: true,
  style: golfIconStyleFn,
  declutter: false,
  zIndex: 900,
});

const btnPuntualLabelsLayer = makeVectorLayer({
  source: btnPuntualSource,
  visible: true,
  style: labelStyleFn,
  declutter: true,
  zIndex: 999,
});

const btnRecintoLayer = makeVectorLayer({
  source: makeGeoJsonSource('./data/BTN_Recinto_CampoGolf.geojson'),
  visible: false,
  style: btnRecintoStyleFn,
  zIndex: 100,
});

const btnZonasVerdesLayer = makeVectorLayer({
  source: makeGeoJsonSource('./data/BTN_ZonasVerdes_CamposGolf_T2.geojson'),
  visible: false,
  style: btnZonasStyleFn,
  zIndex: 200,
});

const osmAreaLayer = makeVectorLayer({
  source: makeGeoJsonSource('./data/OSM_Area.geojson'),
  visible: false,
  style: osmAreaStyleFn,
  zIndex: 300,
});

const osmLineLayer = makeVectorLayer({
  source: makeGeoJsonSource('./data/OSM_Line.geojson'),
  visible: false,
  style: osmLineStyleFn,
  zIndex: 400,
});

const osmPointLayer = makeVectorLayer({
  source: makeGeoJsonSource('./data/OSM_Point.geojson'),
  visible: false,
  style: osmPointStyleFn,
  declutter: false,
  zIndex: 500,
});

map.addLayer(btnPuntualIconsLayer);
map.addLayer(btnPuntualLabelsLayer);

map.addLayer(btnZonasVerdesLayer);
map.addLayer(btnRecintoLayer);

map.addLayer(osmAreaLayer);
map.addLayer(osmLineLayer);
map.addLayer(osmPointLayer);

// ========================
// Hover sobre puntos de golf
// ========================

map.on('pointermove', (evt) => {
  if (evt.dragging) return;

  const pixel = map.getEventPixel(evt.originalEvent);
  let found = null;

  map.forEachFeatureAtPixel(
    pixel,
    (feature, layer) => {
      if (layer === btnPuntualIconsLayer || layer === btnPuntualLabelsLayer) {
        found = feature;
        return true;
      }
      return false;
    },
    { hitTolerance: 6 }
  );

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

// Auto-fit a datos
btnPuntualSource.once('change', () => {
  if (btnPuntualSource.getState() === 'ready') {
    const extent = btnPuntualSource.getExtent();
    if (extent && extent[0] !== Infinity) {
      map.getView().fit(extent, { padding: [60, 60, 60, 60] });
    }
  }
});

// ========================
// Índice interno provincia -> municipios (desde GeoJSON)
// ========================

const provToMunicipios = new window.Map(); // provKey -> Map(munKey -> displayMun)
const provKeyToDisplay = new window.Map(); // provKey -> displayProvincia

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
    const munMap = provToMunicipios.get(provKey);
    munMap.set(norm(munRaw), munRaw);
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
    if (!g) continue;
    extentExtend(ext, g.getExtent());
  }

  if (extentIsEmpty(ext)) return null;
  return ext;
}

// construir índice cuando el GeoJSON esté listo
const onGolfReady = () => {
  if (btnPuntualSource.getState() === 'ready') buildProvMunIndexFromGolf();
};
onGolfReady();
btnPuntualSource.on('change', onGolfReady);

// ========================
// Modal al hacer clic + fondo apagado
// ========================

const popupEl = document.getElementById('popup');
const popupCloser = document.getElementById('popup-closer');
const popupContent = document.getElementById('popup-content');

popupEl.classList.add('modal-card');
popupEl.setAttribute('aria-hidden', 'true');
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
popupCloser.addEventListener('click', (ev) => {
  ev.preventDefault();
  closeModal();
});
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeModal();
});

// ========================
// Popup “bonito” (imagen + título + teléfono + email + link)
// ========================

const phoneSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.07 21 3 13.93 3 5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.24 1.01l-2.2 2.2Z"/>
</svg>`;

const mailSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="currentColor" d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z"/>
</svg>`;

function asCleanText(v) {
  const s = (v ?? '').toString().trim();
  return s;
}

function normalizeUrl(u) {
  const s = asCleanText(u);
  if (!s) return '';
  // Si viene sin protocolo, asumimos https
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function renderClubPopup(props) {
  const nombre = asCleanText(props.nombre) || 'Club de golf';
  const telefono = asCleanText(props.telefono);
  const email = asCleanText(props.email);
  const imagen = asCleanText(props.imagen_main);
  const url = normalizeUrl(props.url);

  const safeNombre = escapeHtml(nombre);

  const telRow = telefono
    ? `
      <div style="display:flex; align-items:center; gap:10px; margin-top:10px;">
        <div style="width:22px; height:22px; display:flex; align-items:center; justify-content:center; color: rgba(0,0,0,0.70);">
          ${phoneSvg}
        </div>
        <div style="font-size:14px; color: rgba(0,0,0,0.80);">
          ${escapeHtml(telefono)}
        </div>
      </div>`
    : '';

  const mailRow = email
    ? `
      <div style="display:flex; align-items:center; gap:10px; margin-top:8px;">
        <div style="width:22px; height:22px; display:flex; align-items:center; justify-content:center; color: rgba(0,0,0,0.70);">
          ${mailSvg}
        </div>
        <div style="font-size:14px; color: rgba(0,0,0,0.80); word-break: break-word;">
          ${escapeHtml(email)}
        </div>
      </div>`
    : '';

  const linkRow = url
    ? `
      <div style="margin-top:14px;">
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"
           style="display:inline-block; font-weight:700; text-decoration:none;">
          Ver ficha técnica en la RFEG
        </a>
      </div>`
    : '';

  const imageBlock = imagen
    ? `
      <div style="width:100%; height:220px; border-radius:14px; overflow:hidden; background: rgba(0,0,0,0.06);">
        <img src="${escapeHtml(imagen)}" alt="${safeNombre}"
             style="width:100%; height:100%; object-fit:cover; display:block;" />
      </div>`
    : `
      <div style="width:100%; height:180px; border-radius:14px; overflow:hidden; background: rgba(0,0,0,0.06); display:flex; align-items:center; justify-content:center; color: rgba(0,0,0,0.55); font-weight:600;">
        Sin imagen disponible
      </div>`;

  return `
    <div style="max-width: 520px;">
      ${imageBlock}

      <div style="margin-top:12px; font-size:20px; font-weight:800; line-height:1.15; color: rgba(0,0,0,0.90);">
        ${safeNombre}
      </div>

      ${telRow}
      ${mailRow}
      ${linkRow}
    </div>
  `;
}

// ========================
// Click: comportamiento distinto según zoom
// - zoom < 16: centrar + zoom 16 (sin modal)
// - zoom >= 16: abrir modal (centrando suave) y render popup nuevo
// ========================

map.on('singleclick', (evt) => {
  let foundFeature = null;
  let foundLayer = null;

  map.forEachFeatureAtPixel(
    evt.pixel,
    (feature, layer) => {
      foundFeature = feature;
      foundLayer = layer;
      return true;
    },
    { hitTolerance: 6 }
  );

  const isGolf =
    foundFeature &&
    (foundLayer === btnPuntualIconsLayer || foundLayer === btnPuntualLabelsLayer);

  if (!isGolf) {
    closeModal();
    return;
  }

  const currentZoom = map.getView().getZoom() ?? 0;

  // Centro del punto clicado
  const geom = foundFeature.getGeometry();
  let center = null;

  if (geom && typeof geom.getCoordinates === 'function') {
    const coords = geom.getCoordinates();
    if (Array.isArray(coords) && typeof coords[0] === 'number') {
      center = coords; // Point
    }
  }
  if (!center && geom && typeof geom.getExtent === 'function') {
    const ext = geom.getExtent();
    center = [(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2];
  }

  // 1) Zoom por debajo de 16 → SOLO centrar + zoom 16, sin modal
  if (currentZoom < 16) {
    if (center) {
      map.getView().animate({ center, zoom: 16, duration: 600 });
    } else {
      map.getView().animate({ zoom: 16, duration: 600 });
    }
    return;
  }

  // 2) Zoom 16 o superior → abrir modal (centrando suave opcional)
  if (center) {
    map.getView().animate({ center, duration: 250 });
  }

  const props = { ...foundFeature.getProperties() };
  delete props.geometry;

  popupContent.innerHTML = renderClubPopup(props);
  openModal();
});

// ========================
// Indicador de zoom
// ========================

function setupZoomIndicator(mapInstance) {
  const el = document.createElement('div');
  el.className = 'zoom-indicator';
  el.textContent = 'Zoom: —';
  mapInstance.getTargetElement().appendChild(el);

  const update = () => {
    const z = mapInstance.getView().getZoom();
    el.textContent = `Zoom: ${z !== undefined ? z.toFixed(2) : '—'}`;
  };

  update();
  mapInstance.getView().on('change:resolution', update);
}

setupZoomIndicator(map);

// ========================
// Leyenda flotante
// ========================

function setupMapLegend(mapInstance) {
  const el = document.createElement('div');
  el.className = 'map-legend';
  el.innerHTML = `
    <img src="/icons/leyenda.png" alt="Leyenda del mapa" />
  `;
  mapInstance.getTargetElement().appendChild(el);
}

setupMapLegend(map);

// ========================
// Buscador (Nominatim) + Buscar por provincia/municipio (interno)
// ========================

const bluePinSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24">
  <path fill="#1e88e5" d="M12 2c-3.86 0-7 3.14-7 7c0 5.25 7 13 7 13s7-7.75 7-13c0-3.86-3.14-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/>
</svg>`;
const bluePinUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(bluePinSvg);

const searchMarkerSource = new VectorSource();

const searchMarkerLayer = new VectorLayer({
  source: searchMarkerSource,
  zIndex: 2000,
  style: new Style({
    image: new Icon({
      src: bluePinUrl,
      scale: 1,
      anchor: [0.5, 1],
      anchorXUnits: 'fraction',
      anchorYUnits: 'fraction',
    }),
  }),
});
map.addLayer(searchMarkerLayer);

// Capa para dibujar líneas desde el punto buscado a los 3 campos más cercanos
const nearestLinksSource = new VectorSource();
let hoveredRouteIdx = null; // índice (0-2) de la ruta a resaltar desde la lista

const nearestLinksLayer = new VectorLayer({
  source: nearestLinksSource,
  zIndex: 1990,
  style: (f) => {
    const label = f.get('label') || '';
    const idx = f.get('routeIdx');
    const isHover = hoveredRouteIdx !== null && idx === hoveredRouteIdx;

    return new Style({
      // Rutas/líneas más visibles (más grosor)
      stroke: new Stroke({
        color: isHover ? 'rgba(255,235,59,0.95)' : 'rgba(30,136,229,0.85)', // amarillo al hover
        width: isHover ? 7 : 5,
        lineCap: 'round',
        lineJoin: 'round',
      }),

      text: new Text({
        text: label,
        placement: 'line',
        overflow: true,
        font: '700 12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
        fill: new Fill({ color: isHover ? 'rgba(33,33,33,0.95)' : 'rgba(30,136,229,1)' }),
        stroke: new Stroke({ color: 'rgba(255,255,255,0.95)', width: 3 }),
      }),
    });
  },
});
map.addLayer(nearestLinksLayer);

function createSearchBox(mapInstance) {
  const container = document.createElement('div');
  container.className = 'search-box';

  container.innerHTML = `
    <div class="search-title">¿Dónde quieres ir?</div>
    <input id="search-input" class="search-input" type="text"
           placeholder="Escribe una dirección..." autocomplete="off" />

    <div id="search-suggestions" class="search-suggestions" style="display:none;"></div>
    <div id="search-status" class="search-status"></div>

    <div style="display:flex; gap:8px; margin-top:10px;">
      <button id="btn-provincia" type="button" style="flex:1; padding:8px; border-radius:10px; border:1px solid rgba(0,0,0,0.18); background:#fff; cursor:pointer;">
        Buscar por provincia
      </button>
      <button id="btn-municipio" type="button" style="flex:1; padding:8px; border-radius:10px; border:1px solid rgba(0,0,0,0.18); background:#fff; cursor:pointer;">
        Buscar por municipio
      </button>
    </div>

    <div id="panel-provincia" style="display:none; margin-top:8px;">
      <select id="select-provincia" style="width:100%; padding:9px 10px; border-radius:10px; border:1px solid rgba(0,0,0,0.18);">
        <option value="" selected>Cargando provincias…</option>
      </select>
      <div id="prov-status" class="search-status" style="margin-top:6px;"></div>
    </div>

    <div id="panel-municipio" style="display:none; margin-top:8px;">
      <select id="select-provincia-mun" style="width:100%; padding:9px 10px; border-radius:10px; border:1px solid rgba(0,0,0,0.18); margin-bottom:8px;">
        <option value="" selected>Cargando provincias…</option>
      </select>

      <select id="select-municipio" style="width:100%; padding:9px 10px; border-radius:10px; border:1px solid rgba(0,0,0,0.18);">
        <option value="" selected>Selecciona municipio…</option>
      </select>

      <div id="mun-status" class="search-status" style="margin-top:6px;"></div>
    </div>
    <div id="nearby-panel" class="nearby-panel" style="display:none; margin-top:10px;">
      <div class="nearby-title">Campos más cercanos</div>
      <div id="nearby-list" class="nearby-list"></div>
    </div>

<div id="reset-panel" style="display:none; margin-top:10px;">
  <button id="btn-reset-search" type="button" style="
    width:100%;
    padding:8px 10px;
    border-radius:10px;
    border:1px solid rgba(0,0,0,0.18);
    background:#fff;
    cursor:pointer;
    font-weight:700;
  ">
    Realizar una nueva búsqueda
  </button>
</div>

  `;

  mapInstance.getTargetElement().appendChild(container);

  const input = container.querySelector('#search-input');
  const status = container.querySelector('#search-status');
  const sugBox = container.querySelector('#search-suggestions');

  const btnProvincia = container.querySelector('#btn-provincia');
  const btnMunicipio = container.querySelector('#btn-municipio');

  const panelProvincia = container.querySelector('#panel-provincia');
  const panelMunicipio = container.querySelector('#panel-municipio');

  const selectProvincia = container.querySelector('#select-provincia');
  const provStatus = container.querySelector('#prov-status');

  const selectProvinciaMun = container.querySelector('#select-provincia-mun');
  const selectMunicipio = container.querySelector('#select-municipio');
  const munStatus = container.querySelector('#mun-status');

const resetPanel = container.querySelector('#reset-panel');
const btnResetSearch = container.querySelector('#btn-reset-search');

function showResetButton(show) {
  if (!resetPanel) return;
  resetPanel.style.display = show ? 'block' : 'none';
}

// Limpia cualquier resultado previo (marker, rutas, lista, hover, estados UI)
function resetSearchState() {
  // limpia input + sugerencias
  if (input) input.value = '';
  if (status) status.textContent = '';
  hideSuggestions();

  // oculta paneles de provincia/municipio y resetea selects
  if (panelProvincia) panelProvincia.style.display = 'none';
  if (panelMunicipio) panelMunicipio.style.display = 'none';

  if (selectProvincia) selectProvincia.value = '';
  if (selectProvinciaMun) selectProvinciaMun.value = '';
  if (selectMunicipio) {
    selectMunicipio.innerHTML = '<option value="" selected>Selecciona municipio…</option>';
    selectMunicipio.value = '';
  }
  if (provStatus) provStatus.textContent = '';
  if (munStatus) munStatus.textContent = '';

  // quita marcador del punto de búsqueda
  searchMarkerSource.clear();

  // quita lista y rutas de "más cercanos"
  clearNearestUI();

  // resetea hover de rutas
  hoveredRouteIdx = null;
  nearestLinksLayer.changed();

  // cierra ficha si estuviera abierta
  try { closeModal(); } catch (_) {}
  try { closePopup(); } catch (_) {}

  // oculta el botón hasta la siguiente búsqueda
  showResetButton(false);
}

btnResetSearch?.addEventListener('click', () => {
  resetSearchState();
});

  // Panel de "más cercanos" (se rellena al seleccionar una dirección)
  const nearbyPanel = container.querySelector('#nearby-panel');
  const nearbyList = container.querySelector('#nearby-list');
  let lastNearest = []; // [{ feature, distM }]

// Hover en la lista: resalta la ruta correspondiente en amarillo
if (nearbyList) {
  nearbyList.addEventListener('mouseover', (ev) => {
    const item = ev.target?.closest?.('.nearby-item');
    if (!item) return;
    const idx = Number(item.getAttribute('data-idx'));
    if (Number.isFinite(idx)) {
      hoveredRouteIdx = idx;
      nearestLinksLayer.changed();
    }
  });

  nearbyList.addEventListener('mouseleave', () => {
    hoveredRouteIdx = null;
    nearestLinksLayer.changed();
  });
}


  let debounceTimer = null;
  let lastResults = [];

  // ------- Nominatim (direcciones) -------
  async function nominatimSearch(q, limit) {
    const url =
      'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({
        format: 'json',
        q,
        countrycodes: 'es,pt',
        limit: String(limit),
        addressdetails: '1',
      }).toString();

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Error Nominatim');
    return await res.json();
  }

  function hideSuggestions() {
    sugBox.style.display = 'none';
    sugBox.innerHTML = '';
    lastResults = [];
  }

  function showSuggestions(results) {
    lastResults = results;
    if (!results || results.length === 0) {
      hideSuggestions();
      return;
    }

    sugBox.innerHTML = results
      .map((r, idx) => {
        const txt = (r.display_name || '').toString();
        return `<div class="search-suggestion" data-idx="${idx}">${txt}</div>`;
      })
      .join('');

    sugBox.style.display = 'block';
  }

  function goToResult(r) {
    if (!r) return;

    const lon = parseFloat(r.lon);
    const lat = parseFloat(r.lat);
    const coord = fromLonLat([lon, lat]);

    mapInstance.getView().animate({ center: coord, duration: 300 });

    searchMarkerSource.clear();
    searchMarkerSource.addFeature(new Feature(new Point(coord)));

    // Además: muestra los 3 campos más cercanos y dibuja las líneas con distancias
    updateNearestClubsFromCoord(coord);
    showResetButton(true);

    status.textContent = r.display_name || 'Listo';
    hideSuggestions();
  }
  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return '—';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    const s = Math.max(0, Math.round(seconds));
    const min = Math.round(s / 60);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h} h ${m} min`;
  }

  function formatCarSummary(distM, durS) {
    const distTxt = formatDistance(distM);
    const durTxt = formatDuration(durS);
    // "8.20 km · 12 min"
    return `${distTxt} · ${durTxt}`;
  }

  function clearNearestUI() {
    if (nearbyPanel) nearbyPanel.style.display = 'none';
    if (nearbyList) nearbyList.innerHTML = '';
    lastNearest = [];
    nearestLinksSource.clear();
  }

  // Calcula los 3 clubes más cercanos al punto seleccionado y actualiza UI + líneas en mapa
  
  // Calcula los 3 clubes más cercanos al punto seleccionado usando *coche* (OSRM demo)
  // Flujo:
  // 1) Preselecciona candidatos por distancia "en línea recta" (rápido y barato)
  // 2) Pide a OSRM una matriz (tabla) de distancias/duraciones desde el punto a esos candidatos
  // 3) Se queda con los 3 mejores (por tiempo) y dibuja la ruta real + etiqueta con km/min
  async function updateNearestClubsFromCoord(coord3857) {
    if (!coord3857) {
      clearNearestUI();
      return;
    }

    // Espera a que el GeoJSON de clubes esté listo
    if (btnPuntualSource.getState() !== 'ready') {
      if (nearbyPanel) nearbyPanel.style.display = 'block';
      if (nearbyList) {
        nearbyList.innerHTML = '<div class="nearby-empty">Cargando datos de clubes…</div>';
      }
      nearestLinksSource.clear();
      return;
    }

    const originLonLat = toLonLat(coord3857);
    const feats = btnPuntualSource.getFeatures();

    // 1) candidatos por distancia recta (para no pedir rutas a los 1000 clubes)
    const straight = [];
    for (const f of feats) {
      const g = f.getGeometry();
      if (!g || typeof g.getCoordinates !== 'function') continue;
      const c = g.getCoordinates();
      const d = getDistance(originLonLat, toLonLat(c));
      straight.push({ feature: f, straightM: d, coord: c });
    }
    straight.sort((a, b) => a.straightM - b.straightM);

    const CANDIDATES = 18; // ajusta si quieres (más = más preciso, pero más lento)
    const candidates = straight.slice(0, CANDIDATES);

    if (candidates.length === 0) {
      clearNearestUI();
      if (nearbyPanel) nearbyPanel.style.display = 'block';
      if (nearbyList) nearbyList.innerHTML = '<div class="nearby-empty">No se encontraron clubes.</div>';
      return;
    }

    // UI de "cargando..."
    if (nearbyPanel) nearbyPanel.style.display = 'block';
    if (nearbyList) nearbyList.innerHTML = '<div class="nearby-empty">Calculando rutas en coche…</div>';
    nearestLinksSource.clear();

    // 2) OSRM TABLE (demo pública). Ojo: es "best effort", puede fallar o limitar.
    // Endpoint: https://router.project-osrm.org/table/v1/driving/{lon,lat};{lon,lat}...
    const coordParts = [
      `${originLonLat[0]},${originLonLat[1]}`,
      ...candidates.map((it) => {
        const ll = toLonLat(it.coord);
        return `${ll[0]},${ll[1]}`;
      }),
    ];

    let routed = null;

    try {
      const tableUrl =
        'https://router.project-osrm.org/table/v1/driving/' +
        coordParts.join(';') +
        '?sources=0&annotations=duration,distance';

      const resp = await fetch(tableUrl);
      if (!resp.ok) throw new Error(`OSRM table HTTP ${resp.status}`);
      const data = await resp.json();

      const durations = data?.durations?.[0]; // seconds, index 0 -> origin
      const distances = data?.distances?.[0]; // meters

      if (!Array.isArray(durations) || !Array.isArray(distances)) {
        throw new Error('OSRM table: respuesta inesperada');
      }

      // Empareja resultados con candidatos (durations/distances[1..N])
      routed = candidates
        .map((it, i) => ({
          ...it,
          durS: durations[i + 1],
          roadM: distances[i + 1],
        }))
        // filtra entradas sin ruta
        .filter((it) => Number.isFinite(it.durS) && Number.isFinite(it.roadM));

      // Si OSRM no devuelve nada útil, forzamos fallback
      if (!routed.length) throw new Error('OSRM table: sin rutas válidas');
    } catch (e) {
      console.warn('OSRM table falló, usando distancia recta como fallback:', e);

      // Fallback: usa distancia recta y "duración aproximada" (40 km/h)
      routed = candidates.map((it) => {
        const roadM = it.straightM;
        const durS = (roadM / 1000 / 40) * 3600;
        return { ...it, roadM, durS, fallback: true };
      });
    }

    // 3) elige los 3 mejores por tiempo (en coche)
    routed.sort((a, b) => a.durS - b.durS);
    lastNearest = routed.slice(0, 3).map((it, i) => ({ ...it, rank: i }));

    // Ajusta la vista para encuadrar el punto buscado + los 3 campos (para ver bien las rutas)
    try {
      const coords = [coord3857, ...lastNearest.map((x) => x.coord)].filter(Boolean);
      if (coords.length >= 2) {
        let minX = coords[0][0], minY = coords[0][1], maxX = coords[0][0], maxY = coords[0][1];
        for (const c of coords) {
          if (!c) continue;
          minX = Math.min(minX, c[0]); minY = Math.min(minY, c[1]);
          maxX = Math.max(maxX, c[0]); maxY = Math.max(maxY, c[1]);
        }
        mapInstance.getView().fit([minX, minY, maxX, maxY], {
          padding: [40, 340, 40, 40],
          duration: 700,
          maxZoom: 16,
        });
      }
    } catch (_) {
      // sin acción
    }


    // UI
    if (nearbyList) {
      if (lastNearest.length === 0) {
        nearbyList.innerHTML = '<div class="nearby-empty">No se encontraron rutas cercanas.</div>';
      } else {
        nearbyList.innerHTML = lastNearest
          .map((it, idx) => {
            const props = it.feature.getProperties ? it.feature.getProperties() : {};
            const name = (props.name || props.nombre || 'Campo de golf').toString();
            const sumTxt = formatCarSummary(it.roadM, it.durS);
            return `<div class="nearby-item" data-idx="${idx}">${escapeHtml(name)} <span class="nearby-dist">(${sumTxt})</span></div>`;
          })
          .join('');
      }
    }

    // 4) rutas en mapa: intenta OSRM ROUTE para los 3 elegidos; si falla, línea recta
    nearestLinksSource.clear();

    await Promise.all(
      lastNearest.map(async (it) => {
        try {
          // Si venimos de fallback, no tiene sentido pedir route
          if (it.fallback) throw new Error('fallback');

          const destLonLat = toLonLat(it.coord);
          const routeUrl =
            'https://router.project-osrm.org/route/v1/driving/' +
            `${originLonLat[0]},${originLonLat[1]};${destLonLat[0]},${destLonLat[1]}` +
            '?overview=full&geometries=geojson';

          const resp = await fetch(routeUrl);
          if (!resp.ok) throw new Error(`OSRM route HTTP ${resp.status}`);
          const data = await resp.json();

          const coordsLL = data?.routes?.[0]?.geometry?.coordinates;
          if (!Array.isArray(coordsLL) || coordsLL.length < 2) {
            throw new Error('OSRM route: geometría inválida');
          }

          const coords3857 = coordsLL.map(([lon, lat]) => fromLonLat([lon, lat]));
          const line = new LineString(coords3857);

          const ft = new Feature({ geometry: line });
          ft.set('routeIdx', it.rank);
          ft.set('label', formatCarSummary(it.roadM, it.durS));
          nearestLinksSource.addFeature(ft);
        } catch (e) {
          // fallback visual: línea recta
          const line = new LineString([coord3857, it.coord]);
          const ft = new Feature({ geometry: line });
          ft.set('routeIdx', it.rank);
          ft.set('label', formatCarSummary(it.roadM, it.durS));
          nearestLinksSource.addFeature(ft);
        }
      })
    );
  }


  async function updateSuggestions() {
    const q = input.value.trim();
    if (q.length < 3) {
      hideSuggestions();
      status.textContent = '';
      return;
    }

    try {
      const results = await nominatimSearch(q, 5);
      showSuggestions(results);
      status.textContent = '';
    } catch (e) {
      console.error(e);
      hideSuggestions();
      status.textContent = 'No se pudieron cargar sugerencias.';
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateSuggestions, 250);
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (lastResults && lastResults.length > 0) {
        goToResult(lastResults[0]);
        return;
      }

      const q = input.value.trim();
      if (!q) return;

      status.textContent = 'Buscando...';
      nominatimSearch(q, 1)
        .then((arr) => goToResult(arr?.[0] ?? null))
        .catch((e) => {
          console.error(e);
          status.textContent = 'No se encontró esa dirección.';
        });
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

    const r = lastResults[parseInt(idx, 10)];
    goToResult(r);
  });

  // Click en uno de los "más cercanos" → centra en el campo (sin abrir la ficha)
  nearbyList?.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const item = target.closest('.nearby-item');
    if (!item) return;
    const idxStr = item.getAttribute('data-idx');
    if (idxStr === null) return;
    const idx = parseInt(idxStr, 10);
    const it = lastNearest[idx];
    if (!it) return;

    const feature = it.feature;
    const geom = feature.getGeometry();
    const center = geom && typeof geom.getCoordinates === 'function' ? geom.getCoordinates() : null;
    if (center) {
      mapInstance.getView().animate({ center, zoom: 16, duration: 650 });
    } else {
      mapInstance.getView().animate({ zoom: 16, duration: 650 });
    }
  });

  input.addEventListener('blur', () => setTimeout(hideSuggestions, 300));

  // ------- Provincias DINÁMICAS desde GeoJSON -------
  function fillProvinciaSelectFromGeoJSON(sel) {
    if (btnPuntualSource.getState() !== 'ready') {
      sel.innerHTML = `<option value="" selected>Cargando provincias…</option>`;
      sel.disabled = true;
      return;
    }

    const provincias = Array.from(provKeyToDisplay.values()).sort((a, b) => a.localeCompare(b, 'es'));
    sel.innerHTML =
      `<option value="" selected>Selecciona provincia…</option>` +
      provincias.map((p) => `<option value="${p}">${p}</option>`).join('');
    sel.disabled = false;
  }

  function refreshProvinciaCombos() {
    fillProvinciaSelectFromGeoJSON(selectProvincia);
    fillProvinciaSelectFromGeoJSON(selectProvinciaMun);
  }

  refreshProvinciaCombos();

  const updateCombosOnReady = () => {
    if (btnPuntualSource.getState() === 'ready') refreshProvinciaCombos();
  };
  btnPuntualSource.on('change', updateCombosOnReady);

  btnProvincia.addEventListener('click', () => {
    const show = panelProvincia.style.display === 'none';
    panelProvincia.style.display = show ? 'block' : 'none';
    panelMunicipio.style.display = 'none';
  });

  btnMunicipio.addEventListener('click', () => {
    const show = panelMunicipio.style.display === 'none';
    panelMunicipio.style.display = show ? 'block' : 'none';
    panelProvincia.style.display = 'none';
  });

  // ------- Buscar por provincia (100% interno) -------
  selectProvincia.addEventListener('change', () => {
    const prov = selectProvincia.value;
    if (!prov) return;

    if (btnPuntualSource.getState() !== 'ready') {
      provStatus.textContent = 'Cargando datos de clubes...';
      return;
    }

    provStatus.textContent = `Centrando en ${prov}...`;

    const extLocal = extentForGolfFilter({ provincia: prov, municipio: null });
    if (!extLocal) {
      provStatus.textContent = 'No se encontraron clubes en esa provincia.';
      return;
    }

    mapInstance.getView().fit(extLocal, {
      padding: [60, 60, 60, 60],
      duration: 600,
      maxZoom: 12,
    });

    const center = extentGetCenter(extLocal);
    searchMarkerSource.clear();
    searchMarkerSource.addFeature(new Feature(new Point(center)));

    // Si veníamos de una búsqueda por dirección, limpia rutas/lista de cercanos
    clearNearestUI();
    showResetButton(true);

    provStatus.textContent = `Mostrando clubes en ${prov}`;
  });

  // ------- Buscar por municipio (100% interno) -------
  selectProvinciaMun.addEventListener('change', () => {
    const prov = selectProvinciaMun.value;

    selectMunicipio.innerHTML = `<option value="" selected>Selecciona municipio…</option>`;
    munStatus.textContent = '';
    if (!prov) return;

    if (btnPuntualSource.getState() !== 'ready') {
      munStatus.textContent = 'Cargando datos de clubes...';
      return;
    }

    const munMap = provToMunicipios.get(norm(prov));
    if (!munMap || munMap.size === 0) {
      munStatus.textContent = 'No hay municipios (con clubes) en esa provincia.';
      return;
    }

    const municipios = Array.from(munMap.values()).sort((a, b) => a.localeCompare(b, 'es'));

    selectMunicipio.innerHTML =
      `<option value="" selected>Selecciona municipio…</option>` +
      municipios.map((m) => `<option value="${m}">${m}</option>`).join('');

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

    mapInstance.getView().fit(ext, {
      padding: [60, 60, 60, 60],
      duration: 600,
      maxZoom: 15,
    });

    const center = extentGetCenter(ext);
    searchMarkerSource.clear();
    searchMarkerSource.addFeature(new Feature(new Point(center)));

    // Si veníamos de una búsqueda por dirección, limpia rutas/lista de cercanos
    clearNearestUI();
    showResetButton(true);

    munStatus.textContent = `Mostrando clubes en ${mun} (${prov})`;
  });
}

createSearchBox(map);

// ========================
// Toggles: capas + mapa base (select)
// ========================

function bindToggle(id, onChange) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`No existe el checkbox #${id}`);
    return;
  }
  onChange(el.checked);
  el.addEventListener('change', () => onChange(el.checked));
}

function bindBasemapSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) {
    console.warn(`No existe el select #${selectId}`);
    return;
  }
  setBaseMap(sel.value);
  sel.addEventListener('change', () => setBaseMap(sel.value));
}

window.addEventListener('DOMContentLoaded', () => {
  bindToggle('chk-btn-puntual', (checked) => {
    btnPuntualIconsLayer.setVisible(checked);
    btnPuntualLabelsLayer.setVisible(checked);
  });

  bindToggle('chk-btn-recinto', (checked) => btnRecintoLayer.setVisible(checked));
  bindToggle('chk-btn-zonas', (checked) => btnZonasVerdesLayer.setVisible(checked));

  bindToggle('chk-osm-area', (checked) => osmAreaLayer.setVisible(checked));
  bindToggle('chk-osm-line', (checked) => osmLineLayer.setVisible(checked));
  bindToggle('chk-osm-point', (checked) => osmPointLayer.setVisible(checked));

  bindBasemapSelect('basemap-select');
});
