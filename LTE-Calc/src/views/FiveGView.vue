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
import {ref, watch} from "vue"
import FiveGSidePanel from "@/components/FiveGSidePanel.vue"
import FiveGMap from "@/components/FiveGMap.vue"
import {
  fetchRoadSpeedsInSquare,
  computeSpeedStats,
  fetchBuildingsInSquare,
  computeBuildingStats,
  fetchBuildingHeightsInSquare,
  computeHeightStats,
  applyBuildingHeights
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

    try {
      const [roadsRes, buildingsRes, heightRes] = await Promise.allSettled([
        fetchRoadSpeedsInSquare(
            selected.value.lat,
            selected.value.lng,
            zoneSideKm.value,
            aborter.signal
        ),
        fetchBuildingsInSquare(
            selected.value.lat,
            selected.value.lng,
            zoneSideKm.value,
            aborter.signal
        ),
        fetchBuildingHeightsInSquare(
            selected.value.lat,
            selected.value.lng,
            zoneSideKm.value,
            aborter.signal
        )
      ])

      if (roadsRes.status === "fulfilled") {
        const {speeds, roads} = roadsRes.value
        speedStats.value = computeSpeedStats(speeds)
        roadsData.value = roads
      } else {
        if (roadsRes.reason?.name !== "AbortError") {
          speedError.value = roadsRes.reason?.message || "Failed to fetch road speeds"
          speedStats.value = null
          roadsData.value = []
        }
      }

      let buildings = []
      if (buildingsRes.status === "fulfilled") {
        const {areas, buildings: rawBuildings} = buildingsRes.value
        buildingStats.value = computeBuildingStats(areas)
        buildings = rawBuildings
        buildingsData.value = rawBuildings
      } else {
        if (buildingsRes.reason?.name !== "AbortError") {
          buildingError.value = buildingsRes.reason?.message || "Failed to fetch buildings"
          buildingStats.value = null
          buildingsData.value = []
        }
      }

      if (heightRes.status === "fulfilled") {
        const {items, heights} = heightRes.value
        const merged = applyBuildingHeights(buildings, items)
        buildingsData.value = merged
        const heightValues = merged.map(b => b.height).filter(n => Number.isFinite(n))
        buildingHeightStats.value = heightValues.length ? computeHeightStats(heightValues) : computeHeightStats(heights)
      } else {
        if (heightRes.reason?.name !== "AbortError") {
          buildingHeightError.value = heightRes.reason?.message || "Failed to fetch building heights"
          buildingHeightStats.value = null
        }
      }
    } catch (e) {
      if (e?.name !== "AbortError") {
        speedError.value = e?.message || "Failed to fetch road speeds"
        speedStats.value = null
        roadsData.value = []
        buildingError.value = e?.message || "Failed to fetch buildings"
        buildingStats.value = null
        buildingsData.value = []
        buildingHeightError.value = e?.message || "Failed to fetch building heights"
        buildingHeightStats.value = null
      }
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
