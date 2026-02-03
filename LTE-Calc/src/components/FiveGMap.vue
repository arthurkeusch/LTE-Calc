<template>
  <section class="mapWrap">
    <div class="map" ref="mapEl"></div>
    <div v-if="roads.length || buildings.length" class="legend">
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
    </div>
  </section>
</template>

<script setup>
import {ref, computed, onMounted, onBeforeUnmount, watch, toRefs} from "vue"
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
  buildings: {
    type: Array,
    default: () => []
  },
  showRoads: {
    type: Boolean,
    default: true
  },
  showBuildings: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['update:selected', 'update:showRoads', 'update:showBuildings'])

const mapEl = ref(null)
const zoneHalfSideM = computed(() => (Number(props.zoneSideKm) * 1000) / 2)
const {showRoads, roads, showBuildings, buildings} = toRefs(props)
const canToggleRoads = computed(() => roads.value.length > 0)
const canToggleBuildings = computed(() => buildings.value.length > 0)

let map = null
let centerDot = null
let square = null
let roadLayers = L.layerGroup()
let buildingLayers = L.layerGroup()

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
      L.polyline(road.geometry, {
        color: getSpeedColor(road.speed),
        weight: 5,
        opacity: 0.7,
        lineJoin: 'round'
      }).addTo(roadLayers)
    })
  }

  buildingLayers.clearLayers()
  if (props.showBuildings) {
    props.buildings.forEach(building => {
      L.polygon(building.geometry, {
        color: "#F5C542",
        weight: 1,
        opacity: 0.8,
        fillColor: "#F5C542",
        fillOpacity: 0.35
      }).addTo(buildingLayers)
    })
  }

  if (fit) map.fitBounds(b, {padding: [18, 18], animate: true})
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
  buildingLayers.addTo(map)

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

watch(() => props.buildings, () => {
  updateLayers(false)
}, {deep: true})

watch(() => props.showBuildings, () => {
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
  gap: 8px;
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

@media (max-width: 900px) {
  .mapWrap {
    height: 65vh;
  }
}
</style>
