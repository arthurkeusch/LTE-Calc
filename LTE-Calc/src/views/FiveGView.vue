<template>
  <div class="nrPage">
    <FiveGSidePanel
        :selected="selected"
        v-model:zoneSideKm="zoneSideKm"
        :speedStats="speedStats"
        :speedLoading="speedLoading"
        :speedError="speedError"
    />
    <FiveGMap
        v-model:selected="selected"
        v-model:showRoads="showRoads"
        :zoneSideKm="zoneSideKm"
        :roads="roadsData"
    />
  </div>
</template>

<script setup>
import {ref, watch} from "vue"
import FiveGSidePanel from "@/components/FiveGSidePanel.vue"
import FiveGMap from "@/components/FiveGMap.vue"
import {fetchRoadSpeedsInSquare, computeSpeedStats} from "@/utils/overpassSpeed"

const zoneSideKm = ref(1.0)
const selected = ref(null)
const showRoads = ref(true)

const speedStats = ref(null)
const roadsData = ref([])
const speedLoading = ref(false)
const speedError = ref(null)

let aborter = null
let debounceTimer = null

function scheduleSpeedRefresh() {
  if (!selected.value) {
    speedStats.value = null
    roadsData.value = []
    speedError.value = null
    speedLoading.value = false
    return
  }

  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    if (aborter) aborter.abort()
    aborter = new AbortController()

    speedLoading.value = true
    speedError.value = null

    try {
      const {speeds, roads} = await fetchRoadSpeedsInSquare(
          selected.value.lat,
          selected.value.lng,
          zoneSideKm.value,
          aborter.signal
      )
      speedStats.value = computeSpeedStats(speeds)
      roadsData.value = roads
    } catch (e) {
      if (e?.name !== "AbortError") {
        speedError.value = e?.message || "Failed to fetch road speeds"
        speedStats.value = null
        roadsData.value = []
      }
    } finally {
      speedLoading.value = false
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
