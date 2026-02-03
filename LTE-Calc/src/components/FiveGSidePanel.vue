<template>
  <aside class="side">
    <div class="sideInner">
      <div class="panel">
        <div class="section">
          <div class="sTitle">Selected center</div>
          <div class="kv">
            <div class="k">Latitude</div>
            <div class="v">{{ selected ? selected.lat.toFixed(6) : "—" }}</div>
          </div>
          <div class="kv">
            <div class="k">Longitude</div>
            <div class="v">{{ selected ? selected.lng.toFixed(6) : "—" }}</div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="sTitle">Area size</div>

          <div class="sizeRow">
            <div class="pill">{{ zoneSideKm.toFixed(1) }} km × {{ zoneSideKm.toFixed(1) }} km</div>
          </div>

          <input
              class="range"
              type="range"
              :value="zoneSideKm"
              @input="$emit('update:zoneSideKm', Number($event.target.value))"
              min="0.2"
              max="10"
              step="0.1"
          />

          <div class="hint">
            {{ Math.round(zoneSideKm * 1000) }} m side length
          </div>
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="sTitle">Road speed distribution</div>

          <div v-if="!selected" class="muted">
            Select a point to compute road speeds.
          </div>

          <div v-else>
            <div v-if="speedLoading" class="muted">Loading speeds…</div>
            <div v-else-if="speedError" class="error">{{ speedError }}</div>
            <div v-else-if="!speedStats || speedStats.count === 0" class="muted">
              No road speed data found in this area.
            </div>
            <div v-else class="speedCard">
              <div class="speedTop">
                <div class="speedMetric">
                  <div class="mLabel">Average</div>
                  <div class="mValue">{{ speedStats.avg.toFixed(1) }} km/h</div>
                </div>
                <div class="speedMeta">
                  <div class="mSmall">{{ speedStats.count }} roads</div>
                  <div class="mSmall">min {{ speedStats.min.toFixed(0) }} / max {{ speedStats.max.toFixed(0) }}</div>
                </div>
              </div>

              <div class="chartWrap">
                <svg class="chart" viewBox="0 0 260 130" preserveAspectRatio="none">
                  <g>
                    <line :x1="padL" :y1="plotBottom" :x2="plotRight" :y2="plotBottom" class="axis" />
                    <line :x1="padL" :y1="plotTop" :x2="padL" :y2="plotBottom" class="axis" />

                    <g v-for="t in xTicks" :key="'x'+t.value">
                      <line :x1="t.x" :y1="plotBottom" :x2="t.x" :y2="plotBottom + 4" class="tickLine" />
                      <text :x="t.x" :y="plotBottom + 14" text-anchor="middle" class="tickText">{{ t.value }}</text>
                    </g>

                    <g v-for="t in yTicks" :key="'y'+t.value">
                      <line :x1="padL - 4" :y1="t.y" :x2="padL" :y2="t.y" class="tickLine" />
                      <text :x="padL - 6" :y="t.y + 3" text-anchor="end" class="tickText">{{ t.value }}</text>
                      <line :x1="padL" :y1="t.y" :x2="plotRight" :y2="t.y" class="gridLine" />
                    </g>
                  </g>

                  <line
                      :x1="xFromSpeed(speedStats.avg)"
                      :y1="plotTop"
                      :x2="xFromSpeed(speedStats.avg)"
                      :y2="plotBottom"
                      class="avgLine"
                  />

                  <g v-for="(b, i) in hist5" :key="i">
                    <rect
                        :x="barX5(i)"
                        :y="plotBottom - barH5(b)"
                        :width="barW5"
                        :height="barH5(b)"
                        class="bar"
                        rx="4"
                    />
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="foot">
        <div class="tip">
          Click anywhere on the map to place the center marker and draw the square.
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { computed } from "vue"

const props = defineProps({
  selected: { type: Object, default: null },
  zoneSideKm: { type: Number, required: true },
  speedStats: { type: Object, default: null },
  speedLoading: { type: Boolean, default: false },
  speedError: { type: String, default: null }
})

defineEmits(["update:zoneSideKm"])

const padL = 34
const padR = 10
const padT = 8
const padB = 40

const plotLeft = padL
const plotRight = 260 - padR
const plotTop = padT
const plotBottom = 130 - padB

function xFromSpeed(value) {
  if (!props.speedStats) return plotLeft
  const min = props.speedStats.min
  const max = props.speedStats.max
  if (max <= min) return plotLeft
  const t = (value - min) / (max - min)
  const x = plotLeft + t * (plotRight - plotLeft)
  return Math.min(plotRight, Math.max(plotLeft, x))
}

const maxHist10 = computed(() => {
  if (!props.speedStats?.hist10?.length) return 1
  return Math.max(1, ...props.speedStats.hist10)
})

const hist5 = computed(() => {
  const h = props.speedStats?.hist10
  if (!Array.isArray(h) || h.length !== 10) return [0, 0, 0, 0, 0]
  return [
    h[0] + h[1],
    h[2] + h[3],
    h[4] + h[5],
    h[6] + h[7],
    h[8] + h[9]
  ]
})

const maxHist5 = computed(() => Math.max(1, ...hist5.value))

function barH5(v) {
  const h = (v / maxHist5.value) * (plotBottom - plotTop)
  return Math.max(1, Math.min(plotBottom - plotTop, h))
}

const barW5 = 30

function barX5(i) {
  const span = plotRight - plotLeft
  const step = span / 5
  return plotLeft + i * step + (step - barW5) / 2
}

const avgX = computed(() => xFromSpeed(props.speedStats?.avg ?? 0))

const xTicks = computed(() => {
  if (!props.speedStats) return []
  const min = Math.round(props.speedStats.min)
  const max = Math.round(props.speedStats.max)
  if (max <= min) return [{ value: min, x: plotLeft }, { value: max, x: plotRight }]
  const n = 5
  const step = Math.max(1, Math.round((max - min) / n))
  const vals = []
  for (let v = min; v <= max; v += step) vals.push(v)
  if (vals[vals.length - 1] !== max) vals.push(max)
  return vals.map(v => ({ value: v, x: xFromSpeed(v) }))
})

const yTicks = computed(() => {
  const maxY = maxHist5.value
  const n = 4
  const step = Math.max(1, Math.round(maxY / n))
  const vals = []
  for (let v = 0; v <= maxY; v += step) vals.push(v)
  if (vals[vals.length - 1] !== maxY) vals.push(maxY)
  return vals.map(v => ({
    value: v,
    y: plotBottom - (v / maxY) * (plotBottom - plotTop)
  }))
})

const quintileEdges = computed(() => {
  if (!props.speedStats) return []
  const d = props.speedStats.deciles || []
  return [
    { from: props.speedStats.min, to: d[1] },
    { from: d[1], to: d[3] },
    { from: d[3], to: d[5] },
    { from: d[5], to: d[7] },
    { from: d[7], to: props.speedStats.max }
  ]
})
</script>

<style scoped>
.side {
  width: 20%;
  min-width: 260px;
  max-width: 360px;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background: radial-gradient(1200px 700px at 40% 20%, rgba(88, 101, 242, 0.18), transparent 60%),
  rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(14px);
}

.sideInner {
  height: 100%;
  padding: 18px 16px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 14px;
}

.panel {
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.section {
  padding: 14px 14px;
  display: grid;
  gap: 10px;
}

.sTitle {
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.2px;
  opacity: 0.82;
}

.kv {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 10px;
}

.k {
  font-size: 12px;
  opacity: 0.72;
}

.v {
  font-size: 12px;
  font-weight: 900;
  opacity: 0.9;
}

.divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
}

.sizeRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.pill {
  width: fit-content;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 900;
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.22);
}

.range {
  width: 100%;
  appearance: none;
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  outline: none;
}

.range::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(88, 101, 242, 0.95);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
}

.range::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(88, 101, 242, 0.95);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
}

.hint {
  font-size: 12px;
  opacity: 0.65;
}

.muted {
  font-size: 12px;
  opacity: 0.7;
}

.error {
  font-size: 12px;
  opacity: 0.9;
}

.speedCard {
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.18);
  padding: 12px;
  display: grid;
  gap: 10px;
}

.speedTop {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
}

.speedMetric {
  display: grid;
  gap: 2px;
}

.mLabel {
  font-size: 11px;
  opacity: 0.75;
}

.mValue {
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.2px;
}

.speedMeta {
  display: grid;
  gap: 2px;
  text-align: right;
}

.mSmall {
  font-size: 11px;
  opacity: 0.7;
}

.chartWrap {
  width: 100%;
  position: relative;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  padding: 8px;
}

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

.avgHint {
  font-size: 11px;
  opacity: 0.65;
}

.foot {
  display: grid;
  gap: 10px;
}

.tip {
  padding: 10px 12px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
  opacity: 0.75;
}

@media (max-width: 900px) {
  .side {
    width: 100%;
    max-width: none;
    min-width: 0;
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
}
</style>
