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
        :anyLoading="anyLoading"
        :loadingProgress="loadingProgress"
    />
    <FiveGMap
        v-model:selected="selected"
        v-model:showRoads="showRoads"
        v-model:showBuildings="showBuildings"
        v-model:showBuildingHeights="showBuildingHeights"
        :zoneSideKm="zoneSideKm"
        :roads="roadsData"
        :buildings="buildingsData"
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
  computeBuildingStats,
  computeHeightStats,
  applyAltimetryHeights
} from "@/utils/overpassSpeed"

const zoneSideKm = ref(1.0)
const selected = ref(null)
const showRoads = ref(true)
const showBuildings = ref(true)
const showBuildingHeights = ref(true)

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
      const roadsPromise = fetchRoadSpeedsInSquare(
          selected.value.lat,
          selected.value.lng,
          zoneSideKm.value,
          aborter.signal
      ).then(({speeds, roads}) => {
        speedStats.value = computeSpeedStats(speeds)
        roadsData.value = roads
        speedLoading.value = false
        speedProgress.value = 1
      }).catch((err) => {
        if (err?.name !== "AbortError") {
          speedError.value = err?.message || "Failed to fetch road speeds"
          speedStats.value = null
          roadsData.value = []
          speedLoading.value = false
          speedProgress.value = 1
        }
      })

      const buildingsPromise = fetchBuildingsInSquare(
          selected.value.lat,
          selected.value.lng,
          zoneSideKm.value,
          aborter.signal
      ).then(({areas, buildings: rawBuildings}) => {
        buildingStats.value = computeBuildingStats(areas)
        buildingsData.value = rawBuildings
        buildingLoading.value = false
        buildingProgress.value = 1
        return rawBuildings
      }).catch((err) => {
        if (err?.name !== "AbortError") {
          buildingError.value = err?.message || "Failed to fetch buildings"
          buildingStats.value = null
          buildingsData.value = []
          buildingLoading.value = false
          buildingProgress.value = 1
        }
        return []
      })

      const heightsPromise = buildingsPromise.then(async (rawBuildings) => {
        try {
          const merged = await applyAltimetryHeights(rawBuildings, aborter.signal, (partial, progress) => {
            buildingsData.value = partial
            const heightValues = partial.map(b => b.height).filter(n => Number.isFinite(n))
            buildingHeightStats.value = computeHeightStats(heightValues)
            if (Number.isFinite(progress)) heightProgress.value = progress
          })
          buildingsData.value = merged
          const heightValues = merged.map(b => b.height).filter(n => Number.isFinite(n))
          buildingHeightStats.value = computeHeightStats(heightValues)
          heightProgress.value = 1
        } catch (e) {
          if (e?.name !== "AbortError") {
            buildingHeightError.value = e?.message || "Failed to fetch altimetry heights"
            buildingHeightStats.value = null
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
