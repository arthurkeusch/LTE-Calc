<template>
  <div class="nrPage">
    <FiveGSidePanel
      :selected="selected"
      v-model:zoneSideKm="zoneSideKm"
    />
    <FiveGMap
      v-model:selected="selected"
      :zoneSideKm="zoneSideKm"
    />
  </div>
</template>

<script setup>
import { ref } from "vue"
import FiveGSidePanel from "@/components/FiveGSidePanel.vue"
import FiveGMap from "@/components/FiveGMap.vue"

const zoneSideKm = ref(1.0)
const selected = ref(null)
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
