<template>
  <div class="nrPage">
    <FiveGSidePanel
        :selected="selected"
        v-model:zoneSideKm="zoneSideKm"
        :speedStats="speedStats"
        :speedLoading="speedLoading"
        :speedError="speedError"
        :buildingStats="buildingStats"
        :buildingLoading="buildingLoading"
        :buildingError="buildingError"
        :buildingHeightStats="buildingHeightStats"
        :buildingHeightLoading="buildingHeightLoading"
        :buildingHeightError="buildingHeightError"
        :densityStats="densityStats"
        :anyLoading="anyLoading"
        :loadingProgress="loadingProgress"
    />
    <FiveGMap
        v-model:selected="selected"
        v-model:showRoads="showRoads"
        v-model:showBuildings="showBuildings"
        v-model:showBuildingHeights="showBuildingHeights"
        v-model:showDensityGrid="showDensityGrid"
        :zoneSideKm="zoneSideKm"
        :roads="roadsData"
        :buildings="buildingsData"
        :densityGrid="densityGrid"
    />
  </div>
</template>

<script setup>
import {ref, watch, computed} from "vue"
import FiveGSidePanel from "@/components/FiveGSidePanel.vue"
import FiveGMap from "@/components/FiveGMap.vue"
import {
  fetchRoadSpeedsInSquare,
  computeSpeedStats,
  fetchBuildingsInSquare,
  loadBuildingHeightsFromCache,
  saveBuildingHeightsToCache,
  computeBuildingStats,
  computeDensityStats,
  computeHeightStats,
  applyAltimetryHeights
} from "@/utils/overpassSpeed"

const zoneSideKm = ref(1.0)
const selected = ref(null)
const showRoads = ref(true)
const showBuildings = ref(true)
const showBuildingHeights = ref(true)
const showDensityGrid = ref(false)

const speedStats = ref(null)
const roadsData = ref([])
const speedLoading = ref(false)
const speedError = ref(null)

const buildingStats = ref(null)
const buildingsData = ref([])
const buildingLoading = ref(false)
const buildingError = ref(null)
const buildingHeightStats = ref(null)
const buildingHeightLoading = ref(false)
const buildingHeightError = ref(null)
const densityStats = ref(null)
const densityGrid = ref([])
const speedProgress = ref(0)
const buildingProgress = ref(0)
const heightProgress = ref(0)
const anyLoading = computed(() => speedLoading.value || buildingLoading.value || buildingHeightLoading.value)
const loadingProgress = computed(() => {
  const total = 3
  const sum = speedProgress.value + buildingProgress.value + heightProgress.value
  return Math.max(0, Math.min(1, sum / total))
})

let aborter = null
let debounceTimer = null

function computeDensityFromBuildings(buildings, center, sideKm) {
  if (!center || !Array.isArray(buildings) || buildings.length === 0) return null
  const sideMeters = Number(sideKm) * 1000
  if (!Number.isFinite(sideMeters) || sideMeters <= 0) return null
  const cellSize = 100
  const cellsPerSide = Math.max(1, Math.ceil(sideMeters / cellSize))
  const totalCells = cellsPerSide * cellsPerSide
  const sums = new Array(totalCells).fill(0)
  const counts = new Array(totalCells).fill(0)
  const half = sideMeters / 2
  const lat0 = center.lat
  const toRad = Math.PI / 180
  const R = 6378137
  const cosLat = Math.cos(lat0 * toRad)

  for (const b of buildings) {
    if (!Number.isFinite(b?.area) || !Array.isArray(b?.geometry) || b.geometry.length === 0) continue
    const c = centroidLatLng(b.geometry)
    if (!c) continue
    const dx = (c.lng - center.lng) * toRad * cosLat * R
    const dy = (c.lat - center.lat) * toRad * R
    const ix = Math.floor((dx + half) / cellSize)
    const iy = Math.floor((dy + half) / cellSize)
    if (ix < 0 || iy < 0 || ix >= cellsPerSide || iy >= cellsPerSide) continue
    const idx = iy * cellsPerSide + ix
    sums[idx] += b.area
    counts[idx] += 1
  }

  const cellArea = cellSize * cellSize
  const coverages = sums.map(a => Math.max(0, Math.min(1, a / cellArea)))
  const maxCount = Math.max(1, ...counts)
  const scores = coverages.map((c, i) => {
    const countNorm = counts[i] / maxCount
    const countBoost = Math.sqrt(Math.max(0, countNorm))
    return Math.max(0, Math.min(1, c * 0.8 + countBoost * 0.2))
  })
  return computeDensityStats(scores)
}

function computeDensityGrid(buildings, center, sideKm) {
  if (!center || !Array.isArray(buildings) || buildings.length === 0) {
    return {cells: [], stats: null}
  }
  const sideMeters = Number(sideKm) * 1000
  if (!Number.isFinite(sideMeters) || sideMeters <= 0) {
    return {cells: [], stats: null}
  }
  const cellSize = 100
  const cellsPerSide = Math.max(1, Math.ceil(sideMeters / cellSize))
  const totalCells = cellsPerSide * cellsPerSide
  const sums = new Array(totalCells).fill(0)
  const counts = new Array(totalCells).fill(0)
  const half = sideMeters / 2
  const lat0 = center.lat
  const toRad = Math.PI / 180
  const R = 6378137
  const cosLat = Math.cos(lat0 * toRad)

  for (const b of buildings) {
    if (!Number.isFinite(b?.area) || !Array.isArray(b?.geometry) || b.geometry.length === 0) continue
    const c = centroidLatLng(b.geometry)
    if (!c) continue
    const dx = (c.lng - center.lng) * toRad * cosLat * R
    const dy = (c.lat - center.lat) * toRad * R
    const ix = Math.floor((dx + half) / cellSize)
    const iy = Math.floor((dy + half) / cellSize)
    if (ix < 0 || iy < 0 || ix >= cellsPerSide || iy >= cellsPerSide) continue
    const idx = iy * cellsPerSide + ix
    sums[idx] += b.area
    counts[idx] += 1
  }

  const cellArea = cellSize * cellSize
  const coverages = sums.map(a => Math.max(0, Math.min(1, a / cellArea)))
  const maxCount = Math.max(1, ...counts)
  const scores = coverages.map((c, i) => {
    const countNorm = counts[i] / maxCount
    const countBoost = Math.sqrt(Math.max(0, countNorm))
    return Math.max(0, Math.min(1, c * 0.4 + countBoost * 0.6))
  })
  const stats = computeDensityStats(scores)
  const dLatPerM = (1 / R) * (180 / Math.PI)
  const dLngPerM = dLatPerM / cosLat
  const cells = []
  for (let iy = 0; iy < cellsPerSide; iy++) {
    for (let ix = 0; ix < cellsPerSide; ix++) {
      const dx0 = -half + ix * cellSize
      const dy0 = -half + iy * cellSize
      const dx1 = dx0 + cellSize
      const dy1 = dy0 + cellSize
      const south = center.lat + dy0 * dLatPerM
      const north = center.lat + dy1 * dLatPerM
      const west = center.lng + dx0 * dLngPerM
      const east = center.lng + dx1 * dLngPerM
      const idx = iy * cellsPerSide + ix
      cells.push({
        score: scores[idx],
        coverage: coverages[idx],
        count: counts[idx],
        bounds: [[south, west], [north, east]]
      })
    }
  }
  return {cells, stats}
}

function centroidLatLng(geometry) {
  const pts = Array.isArray(geometry) ? geometry : []
  if (!pts.length) return null
  let sumLat = 0
  let sumLng = 0
  for (const p of pts) {
    sumLat += p[0]
    sumLng += p[1]
  }
  return {lat: sumLat / pts.length, lng: sumLng / pts.length}
}

function scheduleSpeedRefresh() {
  if (!selected.value) {
    speedStats.value = null
    roadsData.value = []
    speedError.value = null
    speedLoading.value = false
    buildingStats.value = null
    buildingsData.value = []
    buildingError.value = null
    buildingLoading.value = false
    buildingHeightStats.value = null
    buildingHeightError.value = null
    buildingHeightLoading.value = false
    speedProgress.value = 0
    buildingProgress.value = 0
    heightProgress.value = 0
    return
  }

  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    if (aborter) aborter.abort()
    aborter = new AbortController()

    speedLoading.value = true
    speedError.value = null
    buildingLoading.value = true
    buildingError.value = null
    buildingHeightLoading.value = true
    buildingHeightError.value = null
    speedProgress.value = 0
    buildingProgress.value = 0
    heightProgress.value = 0

    try {
      const roadsPromise = (async () => {
        try {
          const {speeds, roads} = await fetchRoadSpeedsInSquare(
              selected.value.lat,
              selected.value.lng,
              zoneSideKm.value,
              aborter.signal
          )
          speedStats.value = computeSpeedStats(speeds)
          roadsData.value = roads
          speedLoading.value = false
          speedProgress.value = 1
        } catch (err) {
          if (err?.name !== "AbortError") {
            speedError.value = err?.message || "Failed to fetch road speeds"
            speedStats.value = null
            roadsData.value = []
            speedLoading.value = false
            speedProgress.value = 1
          }
        }
      })()

      const buildingsPromise = (async () => {
        try {
          const {areas, buildings: rawBuildings} = await fetchBuildingsInSquare(
              selected.value.lat,
              selected.value.lng,
              zoneSideKm.value,
              aborter.signal
          )
          buildingStats.value = computeBuildingStats(areas)
          buildingsData.value = rawBuildings
          buildingLoading.value = false
          buildingProgress.value = 1
          return rawBuildings
        } catch (err) {
          if (err?.name !== "AbortError") {
            buildingError.value = err?.message || "Failed to fetch buildings"
            buildingStats.value = null
            buildingsData.value = []
            buildingLoading.value = false
            buildingProgress.value = 1
          }
          return []
        }
      })()

      const heightsPromise = buildingsPromise.then(async (rawBuildings) => {
        if (!Array.isArray(rawBuildings) || rawBuildings.length === 0) {
          heightProgress.value = 1
          return
        }

        const buildingIds = rawBuildings.map(b => b.id).filter(id => id !== undefined && id !== null)
        let withCached = rawBuildings.slice()
        const cachedHeights = await loadBuildingHeightsFromCache(buildingIds, aborter.signal, (partialHeights, progress) => {
          withCached = rawBuildings.map((b) => {
            const cached = partialHeights?.[b.id]
            const cachedNum = Number(cached)
            if (Number.isFinite(cachedNum) && cachedNum > 0) return {...b, height: cachedNum}
            return b
          })
          buildingsData.value = withCached
          const heightValues = withCached.map(b => b.height).filter(n => Number.isFinite(n))
          if (heightValues.length > 0) {
            buildingHeightStats.value = computeHeightStats(heightValues)
          }
          if (Number.isFinite(progress)) heightProgress.value = Math.min(0.35, progress * 0.35)
        })
        withCached = rawBuildings.map((b) => {
          const cached = cachedHeights?.[b.id]
          const cachedNum = Number(cached)
          if (Number.isFinite(cachedNum) && cachedNum > 0) return {...b, height: cachedNum}
          return b
        })
        buildingsData.value = withCached

        const missing = withCached.filter(b => !Number.isFinite(b.height) || b.height <= 0)
        if (missing.length === 0) {
          const heightValues = withCached.map(b => b.height).filter(n => Number.isFinite(n))
          buildingHeightStats.value = computeHeightStats(heightValues)
          heightProgress.value = 1
          return
        }
        try {
          const mergedMissing = await applyAltimetryHeights(missing, aborter.signal, (partial, progress) => {
            const partialMap = new Map(partial.map(b => [b.id, b]))
            const mergedPartial = withCached.map(b => partialMap.get(b.id) || b)
            buildingsData.value = mergedPartial
            const partialHeights = mergedPartial.map(b => b.height).filter(n => Number.isFinite(n))
            buildingHeightStats.value = computeHeightStats(partialHeights)
            if (Number.isFinite(progress)) {
              heightProgress.value = Math.max(0.35, 0.35 + progress * 0.65)
            }
          })
          const mergedMap = new Map(mergedMissing.map(b => [b.id, b]))
          const mergedAll = withCached.map(b => mergedMap.get(b.id) || b)
          buildingsData.value = mergedAll
          const mergedHeights = mergedAll.map(b => b.height).filter(n => Number.isFinite(n))
          buildingHeightStats.value = computeHeightStats(mergedHeights)
          heightProgress.value = 1
          const toCache = {}
          for (const b of mergedMissing) {
            if (Number.isFinite(b.height)) toCache[b.id] = b.height
          }
          await saveBuildingHeightsToCache(toCache, aborter.signal)
        } catch (e) {
          if (e?.name !== "AbortError") {
            const currentHeights = buildingsData.value.map(b => b.height).filter(n => Number.isFinite(n))
            if (currentHeights.length === 0) {
              buildingHeightError.value = e?.message || "Failed to fetch altimetry heights"
              buildingHeightStats.value = null
            } else {
              buildingHeightStats.value = computeHeightStats(currentHeights)
            }
            heightProgress.value = 1
          }
        }
      })

      await Promise.allSettled([roadsPromise, buildingsPromise, heightsPromise])
    } finally {
      speedLoading.value = false
      buildingLoading.value = false
      buildingHeightLoading.value = false
    }
  }, 350)
}

watch([selected, zoneSideKm], scheduleSpeedRefresh, {deep: true})

watch([buildingsData, selected, zoneSideKm], () => {
  if (!selected.value) {
    densityStats.value = null
    densityGrid.value = []
    return
  }
  const grid = computeDensityGrid(buildingsData.value, selected.value, zoneSideKm.value)
  densityStats.value = grid.stats
  densityGrid.value = grid.cells
}, {deep: true})
</script>

<style scoped>
.nrPage {
  width: 100%;
  height: calc(100vh - 56px);
  display: flex;
  overflow: hidden;
}

@media (max-width: 900px) {
  .nrPage {
    height: auto;
    min-height: calc(100vh - 56px);
    flex-direction: column;
  }
}
</style>
