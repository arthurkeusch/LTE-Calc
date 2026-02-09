<template>
  <section class="mapWrap">
    <div class="map" ref="mapEl"></div>
    <div v-if="roads.length || canyonRoads.length || buildings.length" class="legend">
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
  densityGrid: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits([
  'update:selected',
  'update:showRoads',
  'update:showCanyons',
  'update:showBuildings',
  'update:showBuildingHeights',
  'update:showDensityGrid'
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
  densityGrid
} = toRefs(props)
const canToggleRoads = computed(() => roads.value.length > 0)
const canToggleCanyons = computed(() => canyonRoads.value.length > 0)
const canToggleBuildings = computed(() => buildings.value.length > 0)
const canToggleDensityGrid = computed(() => densityGrid.value.length > 0)
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
const canToggleBuildingHeights = computed(() => showBuildings.value && !!heightRange.value)

let map = null
let centerDot = null
let square = null
let roadLayers = L.layerGroup()
let canyonLayers = L.layerGroup()
let buildingLayers = L.layerGroup()
let densityGridLayers = L.layerGroup()

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

function updateLayers(fit = true) {
  if (!map || !props.selected) return
  const {lat, lng} = props.selected
  const b = boundsFromCenter(lat, lng, zoneHalfSideM.value)

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
        lineJoin: 'round'
      }).addTo(roadLayers)
      line.bindTooltip(`Speed: ${formatSpeed(road.speed)} km/h`, {
        direction: "top",
        sticky: true,
        opacity: 0.9
      })
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
        lineJoin: "round"
      }).addTo(canyonLayers)
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
        fillOpacity: 0.35
      }).addTo(buildingLayers)
      poly.bindTooltip(
          `Area: ${formatArea(building.area)} m²<br/>Height: ${formatHeight(building.height)} m`,
          {
            direction: "top",
            sticky: true,
            opacity: 0.9
          }
      )
    })
  }

  densityGridLayers.clearLayers()
  if (props.showDensityGrid && props.densityGrid.length) {
    const range = densityRange.value
    const minD = range ? range.min : 0
    const maxD = range ? range.max : 1
    props.densityGrid.forEach(cell => {
      const color = densityToColor(cell.score, minD, maxD)
      const rect = L.rectangle(cell.bounds, {
        color,
        weight: 1,
        opacity: 0.65,
        fillColor: color,
        fillOpacity: 0.4
      }).addTo(densityGridLayers)
      const covPct = Number.isFinite(cell.coverage) ? (cell.coverage * 100).toFixed(1) : "0.0"
      const scorePct = Number.isFinite(cell.score) ? (cell.score * 100).toFixed(1) : "0.0"
      const count = Number.isFinite(cell.count) ? cell.count : 0
      rect.bindTooltip(`Score: ${scorePct}%<br/>Coverage: ${covPct}%<br/>Buildings: ${count}`, {
        direction: "top",
        sticky: true,
        opacity: 0.9
      })
    })
  }

  if (fit) map.fitBounds(b, {padding: [18, 18], animate: true})
}

function formatArea(value) {
  if (!Number.isFinite(value)) return "—"
  return Math.round(value).toString()
}

function formatHeight(value) {
  if (!Number.isFinite(value)) return "—"
  return value.toFixed(1)
}

function formatSpeed(value) {
  if (!Number.isFinite(value)) return "—"
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

  roadLayers.addTo(map)
  canyonLayers.addTo(map)
  buildingLayers.addTo(map)
  densityGridLayers.addTo(map)

  map.on("click", onMapClick)

  if (props.selected) {
    updateLayers(true)
  }
})

onBeforeUnmount(() => {
  if (!map) return
  map.off("click", onMapClick)
  map.remove()
  map = null
  centerDot = null
  square = null
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

watch(() => props.densityGrid, () => {
  updateLayers(false)
}, {deep: true})

watch(() => props.showDensityGrid, () => {
  updateLayers(false)
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

@media (max-width: 900px) {
  .mapWrap {
    height: 65vh;
  }
}
</style>

