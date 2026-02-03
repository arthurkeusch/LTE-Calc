<template>
  <section class="mapWrap">
    <div class="map" ref="mapEl"></div>
  </section>
</template>

<script setup>
import {ref, computed, onMounted, onBeforeUnmount, watch} from "vue"
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
  }
})

const emit = defineEmits(['update:selected'])

const mapEl = ref(null)
const zoneHalfSideM = computed(() => (Number(props.zoneSideKm) * 1000) / 2)

let map = null
let centerDot = null
let square = null
let roadLayers = L.layerGroup()

function boundsFromCenter(lat, lng, halfSideM) {
  const latRad = (lat * Math.PI) / 180
  const dLat = (halfSideM / 6378137) * (180 / Math.PI)
  const dLng = dLat / Math.cos(latRad)
  const sw = L.latLng(lat - dLat, lng - dLng)
  const ne = L.latLng(lat + dLat, lng + dLng)
  return L.latLngBounds(sw, ne)
}

function getSpeedColor(speed) {
  // 30 km/h -> Bleu (240)
  // 130 km/h -> Rouge (0)
  const minS = 30
  const maxS = 110
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
  props.roads.forEach(road => {
    L.polyline(road.geometry, {
      color: getSpeedColor(road.speed),
      weight: 5,
      opacity: 0.7,
      lineJoin: 'round'
    }).addTo(roadLayers)
  })

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

@media (max-width: 900px) {
  .mapWrap {
    height: 65vh;
  }
}
</style>
