<template>
  <div class="nrPage">
    <FiveGSidePanel
        :selected="selected"
        v-model:zoneSideKm="zoneSideKm"
        v-model:simulationMode="simulationMode"
        :speedStats="speedStats"
        :speedLoading="speedLoading"
        :speedError="speedError"
        :buildingStats="buildingStats"
        :buildingLoading="buildingLoading"
        :buildingError="buildingError"
        :buildingHeightStats="buildingHeightStats"
        :buildingHeightLoading="buildingHeightLoading"
        :buildingHeightError="buildingHeightError"
        :canyonStats="canyonStats"
        :densityStats="densityStats"
        :vegetationStats="vegetationStats"
        :vegetationLoading="vegetationLoading"
        :vegetationError="vegetationError"
        :reliefStats="reliefStats"
        :reliefLoading="reliefLoading"
        :reliefError="reliefError"
        :nrConfig="nrConfig"
        :antennaSite="antennaSite"
        :anyLoading="anyLoading"
        :loadingProgress="loadingProgress"
        :cacheResetting="cacheResetting"
        :cacheResetError="cacheResetError"
        :cacheStats="cacheStats"
        :cacheStatsLoading="cacheStatsLoading"
        @reset-cache="handleResetCache"
    />
    <FiveGMap
        v-model:selected="selected"
        v-model:showRoads="showRoads"
        v-model:showCanyons="showCanyons"
        v-model:showBuildings="showBuildings"
        v-model:showBuildingHeights="showBuildingHeights"
        v-model:showDensityGrid="showDensityGrid"
        v-model:showVegetation="showVegetation"
        v-model:showRelief="showRelief"
        v-model:showSignal="showSignal"
        :zoneSideKm="zoneSideKm"
        :simulationMode="simulationMode"
        :roads="roadsData"
        :canyonRoads="canyonRoads"
        :buildings="buildingsData"
        :densityGrid="densityGrid"
        :vegetationCells="vegetationCells"
        :reliefCells="reliefCells"
        :signalGrid="signalGrid"
        :antennaSite="antennaSite"
    />
  </div>
</template>

<script setup>
import {ref, watch, computed, onMounted} from "vue"
import FiveGSidePanel from "@/components/FiveGSidePanel.vue"
import FiveGMap from "@/components/FiveGMap.vue"
import {fetchRoadSpeedsInSquare, computeSpeedStats} from "@/utils/roads"
import {
  fetchBuildingsInSquare,
  buildDensityCells,
  densityCellIndex,
  loadBuildingHeightsFromCache,
  saveBuildingHeightsToCache,
  resetBuildingHeightsCache,
  fetchCacheStats,
  loadDensityFromCache,
  saveDensityToCache,
  computeBuildingStats,
  computeDensityStats,
  computeHeightStats,
  applyAltimetryHeights
} from "@/utils/buildings"
import {computeStreetCanyonStats} from "@/utils/canyons"
import {fetchVegetationInSquare} from "@/utils/vegetation"
import {fetchReliefInSquare} from "@/utils/relief"
import {areaCacheKey} from "@/utils/cacheKeys"
import {computeSquareBounds} from "@/utils/shared"
import {computeNrConfig} from "@/utils/nrConfig"
import {computeSignalSimulation} from "@/utils/advancedSimulation"

const zoneSideKm = ref(1.0)
const selected = ref(null)
const showRoads = ref(true)
const showCanyons = ref(false)
const showBuildings = ref(true)
const showBuildingHeights = ref(true)
const showDensityGrid = ref(false)
const showVegetation = ref(false)
const showRelief = ref(false)
const simulationMode = ref("basic")
const showSignal = ref(false)
const advancedRunKey = ref(0)

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
const canyonStats = ref(null)
const canyonRoads = ref([])
const vegetationStats = ref(null)
const vegetationLoading = ref(false)
const vegetationError = ref(null)
const vegetationCells = ref([])
const reliefStats = ref(null)
const reliefLoading = ref(false)
const reliefError = ref(null)
const reliefCells = ref([])
const signalGrid = ref([])
const antennaSite = ref(null)
const speedProgress = ref(0)
const buildingProgress = ref(0)
const heightProgress = ref(0)
const vegetationProgress = ref(0)
const reliefProgress = ref(0)
const cacheResetting = ref(false)
const cacheResetError = ref(null)
const emptyCacheStats = () => ({
  exact: true,
  total: {count: 0, mb: 0},
  heights: {count: 0, mb: 0},
  roads: {count: 0, mb: 0},
  buildings: {count: 0, mb: 0},
  density: {count: 0, mb: 0},
  vegetation: {count: 0, mb: 0},
  relief: {count: 0, mb: 0}
})
const cacheStats = ref(emptyCacheStats())
const cacheStatsLoading = ref(false)
const nrConfig = computed(() => computeNrConfig({
  speedStats: speedStats.value,
  buildingStats: buildingStats.value,
  buildingHeightStats: buildingHeightStats.value,
  canyonStats: canyonStats.value,
  densityStats: densityStats.value,
  vegetationStats: vegetationStats.value,
  reliefStats: reliefStats.value,
  zoneSideKm: zoneSideKm.value
}))
const anyLoading = computed(() => (
  speedLoading.value ||
  buildingLoading.value ||
  buildingHeightLoading.value ||
  vegetationLoading.value ||
  reliefLoading.value
))
const loadingProgress = computed(() => {
  const total = 5
  const sum = speedProgress.value + buildingProgress.value + heightProgress.value + vegetationProgress.value + reliefProgress.value
  return Math.max(0, Math.min(1, sum / total))
})

async function handleResetCache() {
  if (cacheResetting.value) return
  cacheResetError.value = null
  if (!window.confirm("Reset Redis cache for all data?")) return
  cacheResetting.value = true
  try {
    await resetBuildingHeightsCache()
    await loadCacheStats()
  } catch (err) {
    cacheResetError.value = err?.message || "Failed to reset cache"
  } finally {
    cacheResetting.value = false
  }
}

async function loadCacheStats() {
  cacheStatsLoading.value = true
  try {
    const stats = await fetchCacheStats()
    const norm = (v) => ({count: Number(v?.count) || 0, mb: Number(v?.mb) || 0})
    cacheStats.value = {
      exact: stats?.exact !== false,
      total: norm(stats?.total),
      heights: norm(stats?.heights),
      roads: norm(stats?.roads),
      buildings: norm(stats?.buildings),
      density: norm(stats?.density),
      vegetation: norm(stats?.vegetation),
      relief: norm(stats?.relief)
    }
  } catch {
    cacheStats.value = emptyCacheStats()
  } finally {
    cacheStatsLoading.value = false
  }
}

onMounted(() => {
  loadCacheStats()
})

let aborter = null
let debounceTimer = null
let lastDensityKey = null
let lastDensityCount = 0
let cacheStatsTimer = null
let canyonTimer = null
let advancedTimer = null

function scheduleCacheStatsRefresh() {
  if (cacheStatsTimer) clearTimeout(cacheStatsTimer)
  cacheStatsTimer = setTimeout(() => {
    loadCacheStats()
  }, 800)
}

function computeDensityGrid(buildings, bounds, cachedCells) {
  if (!Array.isArray(buildings) || buildings.length === 0) {
    return {cells: [], stats: null, toStore: {}}
  }
  const cells = buildDensityCells(bounds)
  if (!cells.length) {
    return {cells: [], stats: null, toStore: {}}
  }
  const cellsByKey = new Map(cells.map(cell => [cell.key, cell]))

  for (const cell of cells) {
    const entry = cachedCells?.[cell.key]
    const count = Number(entry?.count)
    if (Number.isFinite(count)) {
      cell.count = count
      cell.cached = true
    }
  }

  for (const b of buildings) {
    if (!Array.isArray(b?.geometry) || b.geometry.length === 0) continue
    const c = centroidLatLng(b.geometry)
    if (!c) continue
    const idx = densityCellIndex(c.lat, c.lng)
    if (!idx) continue
    const cell = cellsByKey.get(idx.key)
    if (!cell || cell.cached) continue
    cell.count = (Number(cell.count) || 0) + 1
  }

  for (const cell of cells) {
    if (!Number.isFinite(cell.count)) cell.count = 0
  }
  const counts = cells.map(c => c.count)
  const maxCount = Math.max(1, ...counts)
  const scores = counts.map(c => Math.max(0, Math.min(1, c / maxCount)))
  for (let i = 0; i < cells.length; i++) {
    cells[i].score = scores[i]
  }

  const stats = computeDensityStats(scores)
  const toStore = {}
  for (const cell of cells) {
    if (cell.cached) continue
    toStore[cell.key] = {count: cell.count}
  }
  return {
    cells: cells.map(c => ({score: c.score, count: c.count, bounds: c.bounds})),
    stats,
    toStore
  }
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
    vegetationStats.value = null
    vegetationError.value = null
    vegetationLoading.value = false
    vegetationCells.value = []
    vegetationProgress.value = 0
    reliefStats.value = null
    reliefError.value = null
    reliefLoading.value = false
    reliefCells.value = []
    reliefProgress.value = 0
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
    vegetationLoading.value = true
    vegetationError.value = null
    vegetationProgress.value = 0
    reliefLoading.value = true
    reliefError.value = null
    reliefProgress.value = 0

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

      const vegetationPromise = (async () => {
        try {
          const data = await fetchVegetationInSquare(
              selected.value.lat,
              selected.value.lng,
              zoneSideKm.value,
              aborter.signal
          )
          vegetationStats.value = data
          vegetationCells.value = Array.isArray(data?.cells) ? data.cells : []
          vegetationLoading.value = false
          vegetationProgress.value = 1
        } catch (err) {
          if (err?.name !== "AbortError") {
            vegetationError.value = err?.message || "Failed to fetch vegetation"
            vegetationStats.value = null
            vegetationCells.value = []
            vegetationLoading.value = false
            vegetationProgress.value = 1
          }
        }
      })()

      const reliefPromise = (async () => {
        try {
          const apiKey = import.meta.env.VITE_OPENTOPO_API_KEY
          const data = await fetchReliefInSquare(
              selected.value.lat,
              selected.value.lng,
              zoneSideKm.value,
              {signal: aborter.signal, opentopoApiKey: apiKey}
          )
          reliefStats.value = data
          reliefCells.value = Array.isArray(data?.cells) ? data.cells : []
          reliefLoading.value = false
          reliefProgress.value = 1
        } catch (err) {
          if (err?.name !== "AbortError") {
            reliefError.value = err?.message || "Failed to fetch relief"
            reliefStats.value = null
            reliefCells.value = []
            reliefLoading.value = false
            reliefProgress.value = 1
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

        let cacheBuffer = {}
        let cacheBufferCount = 0
        const cachedIds = new Set()
        let flushInFlight = Promise.resolve()
        const flushCacheBuffer = (force = false) => {
          if (!force && cacheBufferCount < 500) return
          if (cacheBufferCount === 0) return
          const payload = cacheBuffer
          cacheBuffer = {}
          cacheBufferCount = 0
          flushInFlight = flushInFlight
              .then(() => saveBuildingHeightsToCache(payload, aborter.signal))
              .catch(() => {})
        }
        const addToCacheBuffer = (building) => {
          if (!building || building.id === undefined || building.id === null) return
          if (!Number.isFinite(building.height)) return
          if (cachedIds.has(building.id)) return
          cachedIds.add(building.id)
          cacheBuffer[building.id] = building.height
          cacheBufferCount += 1
        }

        const buildingIds = rawBuildings.map(b => b.id).filter(id => id !== undefined && id !== null)
        let withCached = rawBuildings.slice()
        const cachedHeights = await loadBuildingHeightsFromCache(buildingIds, aborter.signal, (partialHeights, progress) => {
          withCached = rawBuildings.map((b) => {
            const cached = partialHeights?.[b.id]
            const cachedNum = Number(cached)
            if (Number.isFinite(cachedNum)) return {...b, height: cachedNum}
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
          if (Number.isFinite(cachedNum)) return {...b, height: cachedNum}
          return b
        })
        buildingsData.value = withCached

        const missing = withCached.filter(b => !Number.isFinite(b.height))
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
            if (partialHeights.length > 0) {
              buildingHeightStats.value = computeHeightStats(partialHeights)
            }
            if (Number.isFinite(progress)) {
              heightProgress.value = Math.max(0.35, 0.35 + progress * 0.65)
            }
            for (const b of partial) addToCacheBuffer(b)
            flushCacheBuffer(false)
          })
          const mergedMap = new Map(mergedMissing.map(b => [b.id, b]))
          const mergedAll = withCached.map(b => mergedMap.get(b.id) || b)
          buildingsData.value = mergedAll
          const mergedHeights = mergedAll.map(b => b.height).filter(n => Number.isFinite(n))
          buildingHeightStats.value = computeHeightStats(mergedHeights)
          heightProgress.value = 1
          for (const b of mergedMissing) addToCacheBuffer(b)
          flushCacheBuffer(true)
          await flushInFlight
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

      await Promise.allSettled([roadsPromise, vegetationPromise, reliefPromise, buildingsPromise, heightsPromise])
      scheduleCacheStatsRefresh()
    } finally {
      speedLoading.value = false
      buildingLoading.value = false
      buildingHeightLoading.value = false
      vegetationLoading.value = false
      reliefLoading.value = false
    }
  }, 350)
}

watch([selected, zoneSideKm], scheduleSpeedRefresh, {deep: true})

watch(simulationMode, () => {
  advancedRunKey.value += 1
})

watch([roadsData, buildingsData, selected], () => {
  if (!selected.value) {
    canyonStats.value = null
    canyonRoads.value = []
    return
  }
  if (canyonTimer) clearTimeout(canyonTimer)
  canyonTimer = setTimeout(() => {
    const result = computeStreetCanyonStats(roadsData.value, buildingsData.value, selected.value)
    canyonStats.value = result?.stats || null
    canyonRoads.value = Array.isArray(result?.roads) ? result.roads : []
  }, 250)
}, {deep: true})

watch([buildingsData, selected, zoneSideKm], async () => {
  if (!selected.value) {
    densityStats.value = null
    densityGrid.value = []
    lastDensityKey = null
    lastDensityCount = 0
    return
  }
  const buildings = buildingsData.value
  if (!Array.isArray(buildings) || buildings.length === 0) {
    densityStats.value = null
    densityGrid.value = []
    lastDensityKey = null
    lastDensityCount = 0
    return
  }

  const key = areaCacheKey(selected.value.lat, selected.value.lng, zoneSideKm.value)
  const count = buildings.length
  if (key === lastDensityKey && count === lastDensityCount) return
  lastDensityKey = key
  lastDensityCount = count

  try {
    const bounds = computeSquareBounds(selected.value.lat, selected.value.lng, zoneSideKm.value)
    const cellKeys = buildDensityCells(bounds).map(c => c.key)
    const cached = await loadDensityFromCache(cellKeys, aborter?.signal)
    if (key !== lastDensityKey) return
    const grid = computeDensityGrid(buildings, bounds, cached)
    densityStats.value = grid.stats
    densityGrid.value = grid.cells
    saveDensityToCache(grid.toStore, aborter?.signal)
    scheduleCacheStatsRefresh()
    return
  } catch (err) {
    if (err?.name === "AbortError") return
  }

  if (key !== lastDensityKey) return
  const bounds = computeSquareBounds(selected.value.lat, selected.value.lng, zoneSideKm.value)
  const grid = computeDensityGrid(buildings, bounds, {})
  densityStats.value = grid.stats
  densityGrid.value = grid.cells
  saveDensityToCache(grid.toStore, aborter?.signal)
  scheduleCacheStatsRefresh()
}, {deep: true})

watch([
  selected,
  zoneSideKm,
  simulationMode,
  advancedRunKey,
  nrConfig,
  densityGrid,
  densityStats,
  vegetationCells,
  vegetationStats,
  reliefCells,
  reliefStats,
  canyonStats,
  buildingHeightStats,
  anyLoading
], () => {
  if (advancedTimer) clearTimeout(advancedTimer)
  if (!selected.value) {
    signalGrid.value = []
    antennaSite.value = null
    return
  }
  advancedTimer = setTimeout(() => {
    const result = computeSignalSimulation({
      mode: simulationMode.value,
      center: selected.value,
      zoneSideKm: zoneSideKm.value,
      nrConfig: nrConfig.value,
      densityGrid: densityGrid.value,
      densityStats: densityStats.value,
      vegetationCells: vegetationCells.value,
      vegetationStats: vegetationStats.value,
      reliefCells: reliefCells.value,
      reliefStats: reliefStats.value,
      canyonStats: canyonStats.value,
      buildingHeightStats: buildingHeightStats.value
    })
    signalGrid.value = Array.isArray(result?.signalGrid) ? result.signalGrid : []
    antennaSite.value = simulationMode.value === "advanced" ? (result?.antenna || null) : null
  }, 180)
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
