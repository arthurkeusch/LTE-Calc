<template>
  <section class="mapWrap">
    <div class="map" ref="mapEl"></div>
    <div
        v-if="roads.length || canyonRoads.length || buildings.length || densityGrid.length || vegetationCells.length || reliefCells.length || signalGrid.length"
        class="legend">
      <div class="legendTitle">Road speed colors</div>
      <label class="legendToggle">
        <input
            class="legendCheckbox"
            type="checkbox"
            :checked="showRoads"
            :disabled="!canToggleRoads"
            @change="$emit('update:showRoads', $event.target.checked)"
        />
        <span>Show roads</span>
      </label>
      <div v-if="showRoads" class="legendScale">
        <div class="legendBar"></div>
        <div class="legendRange">
          <span>20 km/h</span>
          <span>130 km/h</span>
        </div>
      </div>
      <div class="legendDivider"></div>
      <div class="legendTitle">Street canyons</div>
      <label class="legendToggle">
        <input
            class="legendCheckbox"
            type="checkbox"
            :checked="showCanyons"
            :disabled="!canToggleCanyons"
            @change="$emit('update:showCanyons', $event.target.checked)"
        />
        <span>Show canyon types</span>
      </label>
      <div v-if="showCanyons" class="legendScale legendScaleCanyons">
        <div class="legendCanyonTicks">
          <span class="legendCanyonTick legendCanyonTick25">0.5</span>
          <span class="legendCanyonTick legendCanyonTick50">1</span>
          <span class="legendCanyonTick legendCanyonTick75">2</span>
        </div>
        <div class="legendBar legendBarCanyons">
          <span class="legendBarDivider legendBarDivider25"></span>
          <span class="legendBarDivider legendBarDivider50"></span>
          <span class="legendBarDivider legendBarDivider75"></span>
        </div>
        <div class="legendCanyonLabels">
          <span>Open</span>
          <span>Urban</span>
          <span>Canyon</span>
          <span>Dense</span>
        </div>
      </div>
      <div class="legendDivider"></div>
      <div class="legendTitle">Buildings</div>
      <label class="legendToggle">
        <input
            class="legendCheckbox"
            type="checkbox"
            :checked="showBuildings"
            :disabled="!canToggleBuildings"
            @change="$emit('update:showBuildings', $event.target.checked)"
        />
        <span>Show buildings</span>
      </label>
      <div v-if="showBuildings" class="legendKey">
        <span class="legendSwatch"></span>
        <span>Building footprint</span>
      </div>
      <div class="legendDivider"></div>
      <div class="legendTitle">Building heights</div>
      <label class="legendToggle">
        <input
            class="legendCheckbox"
            type="checkbox"
            :checked="showBuildingHeights"
            :disabled="!canToggleBuildingHeights"
            @change="$emit('update:showBuildingHeights', $event.target.checked)"
        />
        <span>Color by height</span>
      </label>
      <div v-if="showBuildings && showBuildingHeights && heightRange" class="legendScale">
        <div class="legendBar legendBarHeights"></div>
        <div class="legendRange">
          <span>{{ Math.round(heightRange.min) }} m</span>
          <span>{{ Math.round(heightRange.max) }} m</span>
        </div>
      </div>
      <div class="legendDivider"></div>
      <div class="legendTitle">Vegetation</div>
      <label class="legendToggle">
        <input
            class="legendCheckbox"
            type="checkbox"
            :checked="showVegetation"
            :disabled="!canToggleVegetation"
            @change="$emit('update:showVegetation', $event.target.checked)"
        />
        <span>Show vegetation</span>
      </label>
      <div v-if="showVegetation && vegetationRange" class="legendScale">
        <div class="legendBar legendBarVegetation"></div>
        <div class="legendRange">
          <span>{{ Math.round(vegetationRange.min * 100) }}%</span>
          <span>{{ Math.round(vegetationRange.max * 100) }}%</span>
        </div>
      </div>
      <div class="legendDivider"></div>
      <div class="legendTitle">Relief</div>
      <label class="legendToggle">
        <input
            class="legendCheckbox"
            type="checkbox"
            :checked="showRelief"
            :disabled="!canToggleRelief"
            @change="$emit('update:showRelief', $event.target.checked)"
        />
        <span>Show elevation</span>
      </label>
      <div v-if="showRelief && reliefRange" class="legendScale">
        <div class="legendBar legendBarRelief"></div>
        <div class="legendRange">
          <span>{{ Math.round(reliefRange.min) }} m</span>
          <span>{{ Math.round(reliefRange.max) }} m</span>
        </div>
      </div>
      <div class="legendTitle">Density grid</div>
      <label class="legendToggle">
        <input
            class="legendCheckbox"
            type="checkbox"
            :checked="showDensityGrid"
            :disabled="!canToggleDensityGrid"
            @change="$emit('update:showDensityGrid', $event.target.checked)"
        />
        <span>Show 100m grid</span>
      </label>
      <div v-if="showDensityGrid && densityRange" class="legendScale">
        <div class="legendBar legendBarDensity"></div>
        <div class="legendRange">
          <span>{{ Math.round(densityRange.min * 100) }}%</span>
          <span>{{ Math.round(densityRange.max * 100) }}%</span>
        </div>
      </div>
      <div class="legendDivider"></div>
      <div class="legendTitle">Signal strength</div>
      <label class="legendToggle">
        <input
            class="legendCheckbox"
            type="checkbox"
            :checked="showSignal"
            @change="$emit('update:showSignal', $event.target.checked)"
        />
        <span>Show signal map</span>
      </label>
      <div v-if="showSignal && signalRange" class="legendScale">
        <div class="legendBar legendBarSignal"></div>
        <div class="legendRange">
          <span>{{ Math.round(signalRange.min) }} dBm</span>
          <span>{{ Math.round(signalRange.max) }} dBm</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import {ref, computed, onMounted, onBeforeUnmount, watch, toRefs} from "vue"
import {classifyStreetCanyonIndex} from "@/utils/canyons"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

const props = defineProps({
  selected: {
    type: Object,
    default: null
  },
  zoneSideKm: {
    type: Number,
    required: true
  },
  simulationMode: {
    type: String,
    default: "basic"
  },
  roads: {
    type: Array,
    default: () => []
  },
  canyonRoads: {
    type: Array,
    default: () => []
  },
  buildings: {
    type: Array,
    default: () => []
  },
  showBuildingHeights: {
    type: Boolean,
    default: true
  },
  showRoads: {
    type: Boolean,
    default: true
  },
  showCanyons: {
    type: Boolean,
    default: false
  },
  showBuildings: {
    type: Boolean,
    default: true
  },
  showDensityGrid: {
    type: Boolean,
    default: false
  },
  showVegetation: {
    type: Boolean,
    default: false
  },
  showRelief: {
    type: Boolean,
    default: false
  },
  showSignal: {
    type: Boolean,
    default: false
  },
  densityGrid: {
    type: Array,
    default: () => []
  },
  vegetationCells: {
    type: Array,
    default: () => []
  },
  reliefCells: {
    type: Array,
    default: () => []
  },
  signalGrid: {
    type: Array,
    default: () => []
  },
  antennaSite: {
    type: Object,
    default: null
  }
})

const emit = defineEmits([
  'update:selected',
  'update:showRoads',
  'update:showCanyons',
  'update:showBuildings',
  'update:showBuildingHeights',
  'update:showDensityGrid',
  'update:showVegetation',
  'update:showRelief',
  'update:showSignal'
])

const mapEl = ref(null)
const zoneHalfSideM = computed(() => (Number(props.zoneSideKm) * 1000) / 2)
const {
  showRoads,
  showCanyons,
  roads,
  canyonRoads,
  showBuildings,
  buildings,
  showBuildingHeights,
  showDensityGrid,
  densityGrid,
  showVegetation,
  vegetationCells,
  showRelief,
  reliefCells,
  showSignal,
  simulationMode,
  signalGrid,
  antennaSite
} = toRefs(props)
const canToggleRoads = computed(() => roads.value.length > 0)
const canToggleCanyons = computed(() => canyonRoads.value.length > 0)
const canToggleBuildings = computed(() => buildings.value.length > 0)
const canToggleDensityGrid = computed(() => densityGrid.value.length > 0)
const canToggleVegetation = computed(() => vegetationCells.value.length > 0)
const canToggleRelief = computed(() => reliefCells.value.length > 0)
const heightRange = computed(() => {
  const vals = (buildings.value || []).map(b => b.height).filter(n => Number.isFinite(n))
  if (!vals.length) return null
  return {min: Math.min(...vals), max: Math.max(...vals)}
})
const densityRange = computed(() => {
  const vals = (densityGrid.value || []).map(c => c.score).filter(n => Number.isFinite(n))
  if (!vals.length) return null
  return {min: Math.min(...vals), max: Math.max(...vals)}
})
const vegetationRange = computed(() => {
  const vals = (vegetationCells.value || []).map(c => c.score).filter(n => Number.isFinite(n))
  if (!vals.length) return null
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  if (max <= min) return {min: 0, max: 1}
  return {min, max}
})
const reliefRange = computed(() => {
  const vals = (reliefCells.value || []).map(c => c.elevation).filter(n => Number.isFinite(n))
  if (!vals.length) return null
  return {min: Math.min(...vals), max: Math.max(...vals)}
})
const signalRange = computed(() => {
  const vals = (signalGrid.value || []).map(c => c.signal).filter(n => Number.isFinite(n))
  if (!vals.length) return null
  const min = Math.max(-120, Math.min(...vals))
  const max = Math.min(-60, Math.max(...vals))
  if (max <= min) return {min: -120, max: -60}
  return {min, max}
})
const signalHoverActive = computed(() => (
    showSignal.value &&
    signalGrid.value.length > 0
))
const canToggleBuildingHeights = computed(() => showBuildings.value && !!heightRange.value)

let map = null
let centerDot = null
let square = null
let roadLayers = L.layerGroup()
let canyonLayers = L.layerGroup()
let buildingLayers = L.layerGroup()
let vegetationLayer = null
let reliefLayer = null
let densityLayer = null
let signalLayer = null
let antennaMarker = null
let antennaHalo = null
let signalTooltip = null
let signalHoverIndex = {zoom: null, index: new Map(), size: L.point(256, 256)}

function boundsFromCenter(lat, lng, halfSideM) {
  const latRad = (lat * Math.PI) / 180
  const dLat = (halfSideM / 6378137) * (180 / Math.PI)
  const dLng = dLat / Math.cos(latRad)
  const sw = L.latLng(lat - dLat, lng - dLng)
  const ne = L.latLng(lat + dLat, lng + dLng)
  return L.latLngBounds(sw, ne)
}

function getSpeedColor(speed) {
  const minS = 20
  const maxS = 130
  const t = Math.max(0, Math.min(1, (speed - minS) / (maxS - minS)))
  const hue = (1 - t) * 240
  return `hsl(${hue}, 100%, 50%)`
}

function getCanyonColor(index) {
  const cls = classifyStreetCanyonIndex(index)
  if (cls === "open") return "#2ECC71"
  if (cls === "urban") return "#F1C40F"
  if (cls === "canyon") return "#E67E22"
  if (cls === "dense") return "#C0392B"
  return "#7F8C8D"
}

function canyonLabel(cls) {
  if (cls === "open") return "open"
  if (cls === "urban") return "urban"
  if (cls === "canyon") return "street canyon"
  if (cls === "dense") return "dense canyon"
  return "unknown"
}

function buildTileIndex(cells, zoom, mapInstance, tileSize, filterCell) {
  const index = new Map()
  if (!mapInstance || !Array.isArray(cells) || cells.length === 0) return index
  const size = tileSize || L.point(256, 256)
  for (const cell of cells) {
    if (filterCell && !filterCell(cell)) continue
    const bounds = cell?.bounds
    if (!Array.isArray(bounds) || bounds.length < 2) continue
    const sw = L.latLng(bounds[0][0], bounds[0][1])
    const ne = L.latLng(bounds[1][0], bounds[1][1])
    const p1 = mapInstance.project(sw, zoom)
    const p2 = mapInstance.project(ne, zoom)
    const minX = Math.min(p1.x, p2.x)
    const maxX = Math.max(p1.x, p2.x)
    const minY = Math.min(p1.y, p2.y)
    const maxY = Math.max(p1.y, p2.y)
    const minTileX = Math.floor(minX / size.x)
    const maxTileX = Math.floor(maxX / size.x)
    const minTileY = Math.floor(minY / size.y)
    const maxTileY = Math.floor(maxY / size.y)
    for (let x = minTileX; x <= maxTileX; x++) {
      for (let y = minTileY; y <= maxTileY; y++) {
        const key = `${x}:${y}`
        const list = index.get(key) || []
        list.push({cell, minX, maxX, minY, maxY})
        index.set(key, list)
      }
    }
  }
  return index
}

function createCellGridLayer({getStyle, filterCell, zIndex}) {
  const layer = L.gridLayer({
    tileSize: 256,
    updateWhenIdle: true,
    keepBuffer: 1,
    pane: "overlayPane"
  })
  if (Number.isFinite(zIndex)) layer.setZIndex(zIndex)
  layer._cells = []
  layer._range = null
  layer._tileIndex = new Map()
  layer._indexZoom = null
  layer._getStyle = getStyle
  layer._filterCell = filterCell

  layer.setCells = function setCells(cells) {
    this._cells = Array.isArray(cells) ? cells : []
    this._tileIndex = new Map()
    this._indexZoom = null
    this.redraw()
  }

  layer.setRange = function setRange(range) {
    this._range = range
    this.redraw()
  }

  layer.createTile = function createTile(coords) {
    const tile = L.DomUtil.create("canvas", "leaflet-tile")
    const size = this.getTileSize()
    tile.width = size.x
    tile.height = size.y
    const ctx = tile.getContext("2d")
    const mapInstance = this._map
    if (!mapInstance || !this._cells.length) return tile
    if (this._indexZoom !== coords.z) {
      this._tileIndex = buildTileIndex(this._cells, coords.z, mapInstance, size, this._filterCell)
      this._indexZoom = coords.z
    }
    const key = `${coords.x}:${coords.y}`
    const entries = this._tileIndex.get(key)
    if (!entries || entries.length === 0) return tile

    const origin = L.point(coords.x * size.x, coords.y * size.y)
    for (const entry of entries) {
      const style = this._getStyle ? this._getStyle(entry.cell, this._range) : null
      if (!style) continue
      const x = entry.minX - origin.x
      const y = entry.minY - origin.y
      const w = entry.maxX - entry.minX
      const h = entry.maxY - entry.minY
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue
      if (style.fill) {
        ctx.globalAlpha = Number.isFinite(style.fillOpacity) ? style.fillOpacity : 1
        ctx.fillStyle = style.fill
        ctx.fillRect(x, y, w, h)
      }
      if (style.stroke && Number.isFinite(style.strokeWidth) && style.strokeWidth > 0) {
        ctx.globalAlpha = Number.isFinite(style.strokeOpacity) ? style.strokeOpacity : 1
        ctx.strokeStyle = style.stroke
        ctx.lineWidth = style.strokeWidth
        ctx.strokeRect(x, y, w, h)
      }
    }
    ctx.globalAlpha = 1
    return tile
  }

  return layer
}

function setLayerVisibility(layer, visible) {
  if (!map || !layer) return
  if (visible) {
    if (!map.hasLayer(layer)) layer.addTo(map)
    if (typeof layer.redraw === "function") layer.redraw()
  } else if (map.hasLayer(layer)) {
    map.removeLayer(layer)
  }
}

function resetSignalHoverIndex() {
  signalHoverIndex = {zoom: null, index: new Map(), size: signalHoverIndex.size}
}

function rebuildSignalHoverIndex() {
  if (!map || !signalHoverActive.value) {
    resetSignalHoverIndex()
    return
  }
  const zoom = map.getZoom()
  signalHoverIndex = {
    zoom,
    index: buildTileIndex(
        signalGrid.value,
        zoom,
        map,
        signalHoverIndex.size,
        (cell) => Number.isFinite(cell?.signal)
    ),
    size: signalHoverIndex.size
  }
}

function findSignalCell(latlng) {
  if (!map || !signalHoverActive.value) return null
  const zoom = map.getZoom()
  if (signalHoverIndex.zoom !== zoom) rebuildSignalHoverIndex()
  const index = signalHoverIndex.index
  if (!index || index.size === 0) return null
  const size = signalHoverIndex.size
  const p = map.project(latlng, zoom)
  const tileX = Math.floor(p.x / size.x)
  const tileY = Math.floor(p.y / size.y)
  const key = `${tileX}:${tileY}`
  const entries = index.get(key)
  if (!entries || entries.length === 0) return null
  for (const entry of entries) {
    if (p.x >= entry.minX && p.x <= entry.maxX && p.y >= entry.minY && p.y <= entry.maxY) {
      return entry.cell
    }
  }
  return null
}

function clearSignalTooltip() {
  if (!map || !signalTooltip) return
  map.removeLayer(signalTooltip)
  signalTooltip = null
}

function updateSignalTooltip(latlng) {
  if (!map || !signalHoverActive.value) {
    clearSignalTooltip()
    return
  }
  const cell = findSignalCell(latlng)
  const signal = Number(cell?.signal)
  if (!Number.isFinite(signal)) {
    clearSignalTooltip()
    return
  }
  const content = `Signal: ${signal.toFixed(1)} dBm`
  if (!signalTooltip) {
    signalTooltip = L.tooltip({
      direction: "top",
      opacity: 0.92,
      offset: [0, -8],
      className: "signalTooltip"
    }).addTo(map)
  }
  signalTooltip.setLatLng(latlng)
  signalTooltip.setContent(content)
}

function updateSignalHoverState() {
  if (!map) return
  if (signalHoverActive.value) {
    map.closeTooltip()
    rebuildSignalHoverIndex()
  } else {
    clearSignalTooltip()
    resetSignalHoverIndex()
  }
}

function getVegetationStyle(cell, range) {
  const score = Number(cell?.score)
  if (!Number.isFinite(score) || score <= 0) return null
  const r = range || {min: 0, max: 1}
  const opacity = vegetationOpacity(score, r.min, r.max)
  if (opacity <= 0) return null
  return {
    fill: "#2ECC71",
    fillOpacity: opacity,
    stroke: "rgba(46, 204, 113, 0.35)",
    strokeOpacity: 0.6,
    strokeWidth: 1
  }
}

function getReliefStyle(cell, range) {
  const elevation = Number(cell?.elevation)
  if (!Number.isFinite(elevation) || !range) return null
  return {
    fill: reliefToColor(elevation, range.min, range.max),
    fillOpacity: 0.45,
    stroke: "rgba(255, 255, 255, 0.08)",
    strokeOpacity: 0.5,
    strokeWidth: 0.6
  }
}

function getDensityStyle(cell, range) {
  const score = Number(cell?.score)
  if (!Number.isFinite(score) || !range) return null
  return {
    fill: densityToColor(score, range.min, range.max),
    fillOpacity: 1,
    stroke: "rgba(255, 255, 255, 0.12)",
    strokeOpacity: 0.5,
    strokeWidth: 0.8
  }
}

function getSignalStyle(cell, range) {
  const signal = Number(cell?.signal)
  if (!Number.isFinite(signal)) return null
  const r = range || {min: -120, max: -60}
  return {
    fill: signalToColor(signal, r.min, r.max),
    fillOpacity: 0.55,
    stroke: "rgba(255, 255, 255, 0.1)",
    strokeOpacity: 0.4,
    strokeWidth: 0.6
  }
}

function updateLayers(fit = true) {
  if (!map || !props.selected) return
  const {lat, lng} = props.selected
  const b = boundsFromCenter(lat, lng, zoneHalfSideM.value)
  const interactive = !signalHoverActive.value

  if (!centerDot) {
    centerDot = L.circleMarker([lat, lng], {
      radius: 7,
      weight: 2,
      opacity: 1,
      color: "#fff",
      fillColor: "#5865F2",
      fillOpacity: 0.8
    }).addTo(map)
  } else {
    centerDot.setLatLng([lat, lng])
  }

  if (!square) {
    square = L.rectangle(b, {
      weight: 5,
      color: "#5865F2",
      opacity: 0.8,
      fill: false,
      dashArray: "5, 10"
    }).addTo(map)
  } else {
    square.setBounds(b)
  }

  roadLayers.clearLayers()
  if (props.showRoads) {
    props.roads.forEach(road => {
      const line = L.polyline(road.geometry, {
        color: getSpeedColor(road.speed),
        weight: 5,
        opacity: 0.7,
        lineJoin: 'round',
        interactive
      }).addTo(roadLayers)
      if (interactive) {
        line.bindTooltip(`Speed: ${formatSpeed(road.speed)} km/h`, {
          direction: "top",
          sticky: true,
          opacity: 0.9
        })
      }
    })
  }

  canyonLayers.clearLayers()
  if (props.showCanyons) {
    props.canyonRoads.forEach(road => {
      if (!Array.isArray(road.geometry) || road.geometry.length < 2) return
      const color = getCanyonColor(road.canyonIndex)
      const cls = classifyStreetCanyonIndex(road.canyonIndex)
      const line = L.polyline(road.geometry, {
        color,
        weight: 6,
        opacity: 0.75,
        lineJoin: "round",
        interactive
      }).addTo(canyonLayers)
      if (interactive) {
        const h = formatNumber(road.canyonHeight, 1)
        const w = formatNumber(road.canyonWidth, 1)
        const idx = formatNumber(road.canyonIndex, 2)
        line.bindTooltip(
            `Canyon index: ${idx}<br/>Class: ${canyonLabel(cls)}<br/>H: ${h} m<br/>W: ${w} m`,
            {
              direction: "top",
              sticky: true,
              opacity: 0.9
            }
        )
      }
    })
  }

  buildingLayers.clearLayers()
  if (props.showBuildings) {
    const range = heightRange.value
    props.buildings.forEach(building => {
      const color = props.showBuildingHeights && range
          ? heightToColor(building.height, range.min, range.max)
          : "#F5C542"
      const poly = L.polygon(building.geometry, {
        color,
        weight: 1,
        opacity: 0.8,
        fillColor: color,
        fillOpacity: 0.35,
        interactive
      }).addTo(buildingLayers)
        if (interactive) {
          poly.bindTooltip(
              `Area: ${formatArea(building.area)} mÂ²<br/>Height: ${formatHeight(building.height)} m`,
              {
                direction: "top",
                sticky: true,
                opacity: 0.9
              }
          )
        }
    })
  }

  if (fit) map.fitBounds(b, {padding: [18, 18], animate: true})
}

function formatArea(value) {
  if (!Number.isFinite(value)) return "â€”"
  return Math.round(value).toString()
}

function formatHeight(value) {
  if (!Number.isFinite(value)) return "â€”"
  return value.toFixed(1)
}

function formatSpeed(value) {
  if (!Number.isFinite(value)) return "â€”"
  return value.toFixed(0)
}

function formatNumber(value, digits) {
  if (!Number.isFinite(value)) return "-"
  const d = Number.isFinite(digits) ? digits : 1
  return value.toFixed(d)
}

function heightToColor(height, min, max) {
  if (!Number.isFinite(height) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min || height <= 0) {
    return "#F5C542"
  }
  const safeMin = Math.max(1, min)
  const safeMax = Math.max(safeMin + 1, max)
  const t = Math.max(0, Math.min(1, (Math.log10(height) - Math.log10(safeMin)) / (Math.log10(safeMax) - Math.log10(safeMin))))
  const hue = (1 - t) * 220
  return `hsl(${hue}, 90%, 55%)`
}

function densityToColor(density, min, max) {
  if (!Number.isFinite(density) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return "rgba(120, 200, 255, 0.25)"
  }
  const t = Math.max(0, Math.min(1, (density - min) / (max - min)))
  const hue = (1 - t) * 220
  return `hsla(${hue}, 90%, 55%, 0.45)`
}

function vegetationOpacity(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0
  const t = max > min ? (value - min) / (max - min) : value
  const clamped = Math.max(0, Math.min(1, t))
  return 0.2 + clamped * 0.6
}

function reliefToColor(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return "rgba(120, 200, 255, 0.3)"
  }
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  const hue = 210 - t * 170
  return `hsl(${hue}, 70%, 50%)`
}

function signalToColor(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return "rgba(200, 200, 200, 0.2)"
  }
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  const hue = 0 + t * 120
  return `hsl(${hue}, 80%, 52%)`
}

function updateAntennaMarker() {
  if (!map) return
  const site = antennaSite.value
  const visible = simulationMode.value === "advanced" &&
      site &&
      Number.isFinite(site.lat) &&
      Number.isFinite(site.lng)

  if (!visible) {
    if (antennaMarker && map.hasLayer(antennaMarker)) {
      map.removeLayer(antennaMarker)
    }
    if (antennaHalo && map.hasLayer(antennaHalo)) {
      map.removeLayer(antennaHalo)
    }
    antennaMarker = null
    antennaHalo = null
    return
  }

  const latlng = [site.lat, site.lng]
  if (!antennaMarker) {
    antennaMarker = L.circleMarker(latlng, {
      radius: 12,
      weight: 3,
      opacity: 1,
      color: "#ffffff",
      fillColor: "#00d1ff",
      fillOpacity: 0.95,
      pane: "markerPane"
    }).addTo(map)
  } else {
    antennaMarker.setLatLng(latlng)
  }
  if (!antennaHalo) {
    antennaHalo = L.circle(latlng, {
      radius: 120,
      color: "#00d1ff",
      weight: 2,
      opacity: 0.7,
      fillColor: "#00d1ff",
      fillOpacity: 0.1,
      pane: "markerPane"
    }).addTo(map)
  } else {
    antennaHalo.setLatLng(latlng)
  }

  const height = formatNumber(site.heightM, 1)
  const gain = formatNumber(site.gainDb, 1)
  const eirp = formatNumber(site.eirpDbm, 1)
  const tooltip = `Antenna site<br/>Height: ${height} m<br/>Gain: ${gain} dBi<br/>EIRP: ${eirp} dBm`
  if (antennaMarker.getTooltip()) {
    antennaMarker.setTooltipContent(tooltip)
  } else {
    antennaMarker.bindTooltip(tooltip, {
      direction: "top",
      sticky: true,
      opacity: 0.9
    })
  }
}

function onMapMove(e) {
  if (!signalHoverActive.value) return
  updateSignalTooltip(e.latlng)
}

function onMapMouseOut() {
  if (!signalHoverActive.value) return
  clearSignalTooltip()
}

function onMapZoomEnd() {
  if (!signalHoverActive.value) return
  rebuildSignalHoverIndex()
}

function onMapClick(e) {
  emit('update:selected', {lat: e.latlng.lat, lng: e.latlng.lng})
}

onMounted(() => {
  map = L.map(mapEl.value, {
    zoomControl: true,
    preferCanvas: true
  }).setView([47.6386, 6.8631], 13)

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map)

  reliefLayer = createCellGridLayer({
    getStyle: getReliefStyle,
    filterCell: (cell) => Number.isFinite(cell?.elevation),
    zIndex: 200
  })
  vegetationLayer = createCellGridLayer({
    getStyle: getVegetationStyle,
    filterCell: (cell) => Number.isFinite(cell?.score) && cell.score > 0,
    zIndex: 300
  })
  densityLayer = createCellGridLayer({
    getStyle: getDensityStyle,
    filterCell: (cell) => Number.isFinite(cell?.score),
    zIndex: 350
  })
  signalLayer = createCellGridLayer({
    getStyle: getSignalStyle,
    filterCell: (cell) => Number.isFinite(cell?.signal),
    zIndex: 420
  })

  reliefLayer.setCells(props.reliefCells)
  reliefLayer.setRange(reliefRange.value)
  vegetationLayer.setCells(props.vegetationCells)
  vegetationLayer.setRange(vegetationRange.value)
  densityLayer.setCells(props.densityGrid)
  densityLayer.setRange(densityRange.value)
  signalLayer.setCells(props.signalGrid)
  signalLayer.setRange(signalRange.value)

  setLayerVisibility(reliefLayer, props.showRelief)
  setLayerVisibility(vegetationLayer, props.showVegetation)
  setLayerVisibility(densityLayer, props.showDensityGrid)
  setLayerVisibility(signalLayer, props.showSignal && props.signalGrid.length > 0)

  roadLayers.addTo(map)
  canyonLayers.addTo(map)
  buildingLayers.addTo(map)

  map.on("click", onMapClick)
  map.on("mousemove", onMapMove)
  map.on("mouseout", onMapMouseOut)
  map.on("zoomend", onMapZoomEnd)

  if (props.selected) {
    updateLayers(true)
  }

  updateAntennaMarker()
  updateSignalHoverState()
})

onBeforeUnmount(() => {
  if (!map) return
  map.off("click", onMapClick)
  map.off("mousemove", onMapMove)
  map.off("mouseout", onMapMouseOut)
  map.off("zoomend", onMapZoomEnd)
  if (antennaMarker && map.hasLayer(antennaMarker)) map.removeLayer(antennaMarker)
  if (antennaHalo && map.hasLayer(antennaHalo)) map.removeLayer(antennaHalo)
  if (signalLayer && map.hasLayer(signalLayer)) map.removeLayer(signalLayer)
  clearSignalTooltip()
  map.remove()
  map = null
  centerDot = null
  square = null
  vegetationLayer = null
  reliefLayer = null
  densityLayer = null
  signalLayer = null
  antennaMarker = null
  antennaHalo = null
  signalTooltip = null
})

watch(() => props.zoneSideKm, () => {
  updateLayers(true)
})

watch(() => props.selected, (newVal) => {
  if (newVal) {
    updateLayers(true)
  }
}, {deep: true})

watch(() => props.roads, () => {
  updateLayers(false)
}, {deep: true})

watch(() => props.showRoads, () => {
  updateLayers(false)
})

watch(() => props.canyonRoads, () => {
  updateLayers(false)
}, {deep: true})

watch(() => props.showCanyons, () => {
  updateLayers(false)
})

watch(() => props.buildings, () => {
  updateLayers(false)
}, {deep: true})

watch(() => props.showBuildings, () => {
  updateLayers(false)
})

watch(() => props.showBuildingHeights, () => {
  updateLayers(false)
})

watch(densityGrid, (cells) => {
  if (densityLayer) densityLayer.setCells(cells)
}, {deep: true})

watch(densityRange, (range) => {
  if (densityLayer) densityLayer.setRange(range)
})

watch(showDensityGrid, (show) => {
  setLayerVisibility(densityLayer, show)
})

watch(vegetationCells, (cells) => {
  if (vegetationLayer) vegetationLayer.setCells(cells)
}, {deep: true})

watch(vegetationRange, (range) => {
  if (vegetationLayer) vegetationLayer.setRange(range)
})

watch(showVegetation, (show) => {
  setLayerVisibility(vegetationLayer, show)
})

watch(reliefCells, (cells) => {
  if (reliefLayer) reliefLayer.setCells(cells)
}, {deep: true})

watch(reliefRange, (range) => {
  if (reliefLayer) reliefLayer.setRange(range)
})

watch(showRelief, (show) => {
  setLayerVisibility(reliefLayer, show)
})

watch(signalGrid, (cells) => {
  if (signalLayer) signalLayer.setCells(cells)
  updateSignalHoverState()
  const visible = showSignal.value &&
      Array.isArray(cells) &&
      cells.length > 0
  setLayerVisibility(signalLayer, visible)
  if (showSignal.value) {
    updateLayers(false)
  }
}, {deep: true})

watch(signalRange, (range) => {
  if (signalLayer) signalLayer.setRange(range)
})

watch([showSignal, signalGrid], ([show, cells]) => {
  const visible = show && Array.isArray(cells) && cells.length > 0
  setLayerVisibility(signalLayer, visible)
})

watch([simulationMode, showSignal, antennaSite], () => {
  updateAntennaMarker()
}, {deep: true})

watch([simulationMode, showSignal], () => {
  updateLayers(false)
  updateSignalHoverState()
})
</script>

<style scoped>
.mapWrap {
  flex: 1;
  height: 100%;
  position: relative;
}

.map {
  width: 100%;
  height: 100%;
}

.legend {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 500;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(8, 8, 10, 0.72);
  color: rgba(255, 255, 255, 0.9);
  display: grid;
  gap: 5px;
  backdrop-filter: blur(8px);
}

.legendTitle {
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.2px;
  opacity: 0.8;
  text-transform: uppercase;
}

.legendToggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  opacity: 0.9;
}

.legendCheckbox {
  accent-color: #5865F2;
  width: 14px;
  height: 14px;
}

.legendScale {
  display: grid;
  gap: 8px;
}

.legendBar {
  height: 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: linear-gradient(90deg, hsl(240, 100%, 50%), hsl(0, 100%, 50%));
}

.legendBarHeights {
  background: linear-gradient(90deg, hsl(220, 90%, 55%), hsl(0, 90%, 55%));
}

.legendBarDensity {
  background: linear-gradient(90deg, hsla(220, 90%, 55%, 0.4), hsla(0, 90%, 55%, 0.8));
}

.legendBarVegetation {
  background: linear-gradient(90deg, rgba(46, 204, 113, 0.2), rgba(46, 204, 113, 0.9));
}

.legendBarRelief {
  background: linear-gradient(90deg, hsl(210, 70%, 50%), hsl(40, 80%, 45%));
}

.legendBarSignal {
  background: linear-gradient(90deg, #c0392b, #f1c40f, #2ecc71);
}

.legendScaleCanyons {
  gap: 6px;
}

.legendBarCanyons {
  position: relative;
  background: linear-gradient(
      90deg,
      #2ECC71 0%,
      #2ECC71 25%,
      #F1C40F 25%,
      #F1C40F 50%,
      #E67E22 50%,
      #E67E22 75%,
      #C0392B 75%,
      #C0392B 100%
  );
}

.legendBarDivider {
  position: absolute;
  top: -1px;
  bottom: -1px;
  width: 1px;
  background: rgba(255, 255, 255, 0.55);
}

.legendBarDivider25 {
  left: 25%;
}

.legendBarDivider50 {
  left: 50%;
}

.legendBarDivider75 {
  left: 75%;
}

.legendRange {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  opacity: 0.7;
}

.legendDivider {
  height: 1px;
  background: rgba(255, 255, 255, 0.12);
}

.legendKey {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  opacity: 0.85;
}

.legendSwatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: rgba(245, 197, 66, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.legendCanyonTicks {
  position: relative;
  height: 12px;
  font-size: 9px;
  opacity: 0.75;
}

.legendCanyonTick {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
}

.legendCanyonTick25 {
  left: 25%;
}

.legendCanyonTick50 {
  left: 50%;
}

.legendCanyonTick75 {
  left: 75%;
}

.legendCanyonLabels {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  font-size: 9px;
  opacity: 0.75;
  text-align: center;
}

:global(.signalTooltip) {
  background: rgba(12, 14, 18, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  font-size: 11px;
  padding: 4px 8px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
}

@media (max-width: 900px) {
  .mapWrap {
    height: 65vh;
  }
}
</style>




