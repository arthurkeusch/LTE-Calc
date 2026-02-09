<template>
  <svg class="chart" viewBox="0 0 260 130" preserveAspectRatio="none">
    <g>
      <line :x1="plotLeft" :y1="plotBottom" :x2="plotRight" :y2="plotBottom" class="axis" />
      <line :x1="plotLeft" :y1="plotTop" :x2="plotLeft" :y2="plotBottom" class="axis" />

      <g v-for="t in xTicks" :key="'x'+t.value">
        <line :x1="t.x" :y1="plotBottom" :x2="t.x" :y2="plotBottom + 4" class="tickLine" />
        <text :x="t.x" :y="plotBottom + 14" text-anchor="middle" class="tickText">{{ t.value }}</text>
      </g>

      <g v-for="t in yTicks" :key="'y'+t.value">
        <line :x1="plotLeft - 4" :y1="t.y" :x2="plotLeft" :y2="t.y" class="tickLine" />
        <text :x="plotLeft - 6" :y="t.y + 3" text-anchor="end" class="tickText">{{ t.value }}</text>
        <line :x1="plotLeft" :y1="t.y" :x2="plotRight" :y2="t.y" class="gridLine" />
      </g>
    </g>

    <line
        v-if="showAvg"
        :x1="avgX"
        :y1="plotTop"
        :x2="avgX"
        :y2="plotBottom"
        class="avgLine"
    />

    <g v-for="(bar, i) in bars" :key="'b'+i">
      <rect
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          class="bar"
          rx="4"
      />
    </g>
  </svg>
</template>

<script setup>
import { computed } from "vue"

const props = defineProps({
  xTicks: { type: Array, default: () => [] },
  yTicks: { type: Array, default: () => [] },
  bars: { type: Array, default: () => [] },
  avgX: { type: Number, default: null },
  plotLeft: { type: Number, default: 34 },
  plotRight: { type: Number, default: 250 },
  plotTop: { type: Number, default: 8 },
  plotBottom: { type: Number, default: 90 }
})

const showAvg = computed(() => Number.isFinite(props.avgX))
</script>

<style scoped>
.chart {
  width: 100%;
  height: 130px;
  display: block;
}

.bar {
  fill: rgba(88, 101, 242, 0.85);
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 1;
}

.avgLine {
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 2;
  opacity: 0.75;
}

.axis {
  stroke: rgba(255, 255, 255, 0.22);
  stroke-width: 1.2;
}

.tickLine {
  stroke: rgba(255, 255, 255, 0.22);
  stroke-width: 1;
}

.tickText {
  fill: rgba(255, 255, 255, 0.75);
  font-size: 9px;
  font-weight: 800;
}

.gridLine {
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 1;
}
</style>
