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
            <div v-if="speedError" class="error">{{ speedError }}</div>
            <div v-else-if="!speedStats || speedStats.count === 0" class="muted">
              <span v-if="speedLoading">Loading speeds…</span>
              <span v-else>No road speed data found in this area.</span>
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
                <div v-if="speedLoading" class="chartSpinner">
                  <div class="spinner"></div>
                </div>
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

        <div class="divider"></div>

        <div class="section">
          <div class="sTitle">Building footprint distribution</div>

          <div v-if="!selected" class="muted">
            Select a point to compute building footprints.
          </div>

          <div v-else>
            <div v-if="buildingError" class="error">{{ buildingError }}</div>
            <div v-else-if="!buildingStats || buildingStats.count === 0" class="muted">
              <span v-if="buildingLoading">Loading buildings...</span>
              <span v-else>No building data found in this area.</span>
            </div>
            <div v-else class="speedCard">
              <div class="speedTop">
                <div class="speedMetric">
                  <div class="mLabel">Average area</div>
                  <div class="mValue">{{ buildingStats.avg.toFixed(0) }} m2</div>
                </div>
                <div class="speedMeta">
                  <div class="mSmall">{{ buildingStats.count }} buildings</div>
                  <div class="mSmall">min {{ buildingStats.min.toFixed(0) }} / max {{ buildingStats.max.toFixed(0) }}</div>
                </div>
              </div>

              <div class="chartWrap">
                <div v-if="buildingLoading" class="chartSpinner">
                  <div class="spinner"></div>
                </div>
                <svg class="chart" viewBox="0 0 260 130" preserveAspectRatio="none">
                  <g>
                    <line :x1="padL" :y1="plotBottom" :x2="plotRight" :y2="plotBottom" class="axis" />
                    <line :x1="padL" :y1="plotTop" :x2="padL" :y2="plotBottom" class="axis" />

                    <g v-for="t in bXTicks" :key="'bx'+t.value">
                      <line :x1="t.x" :y1="plotBottom" :x2="t.x" :y2="plotBottom + 4" class="tickLine" />
                      <text :x="t.x" :y="plotBottom + 14" text-anchor="middle" class="tickText">{{ t.value }}</text>
                    </g>

                    <g v-for="t in bYTicks" :key="'by'+t.value">
                      <line :x1="padL - 4" :y1="t.y" :x2="padL" :y2="t.y" class="tickLine" />
                      <text :x="padL - 6" :y="t.y + 3" text-anchor="end" class="tickText">{{ t.value }}</text>
                      <line :x1="padL" :y1="t.y" :x2="plotRight" :y2="t.y" class="gridLine" />
                    </g>
                  </g>

                  <line
                      :x1="bXFromArea(buildingStats.avg)"
                      :y1="plotTop"
                      :x2="bXFromArea(buildingStats.avg)"
                      :y2="plotBottom"
                      class="avgLine"
                  />

                  <g v-for="(b, i) in bHist5" :key="'bb'+i">
                    <rect
                        :x="barX5(i)"
                        :y="plotBottom - bBarH5(b)"
                        :width="barW5"
                        :height="bBarH5(b)"
                        class="bar"
                        rx="4"
                    />
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="sTitle">Building height distribution</div>

          <div v-if="!selected" class="muted">
            Select a point to compute building heights.
          </div>

          <div v-else>
            <div v-if="buildingHeightError" class="error">{{ buildingHeightError }}</div>
            <div v-else-if="!buildingHeightStats || buildingHeightStats.count === 0" class="muted">
              <span v-if="buildingHeightLoading">Loading heights...</span>
              <span v-else>No building height data found in this area.</span>
            </div>
            <div v-else class="speedCard">
              <div class="speedTop">
                <div class="speedMetric">
                  <div class="mLabel">Average height</div>
                  <div class="mValue">{{ buildingHeightStats.avg.toFixed(1) }} m</div>
                </div>
                <div class="speedMeta">
                  <div class="mSmall">{{ buildingHeightStats.count }} buildings</div>
                  <div class="mSmall">min {{ buildingHeightStats.min.toFixed(1) }} / max {{ buildingHeightStats.max.toFixed(1) }}</div>
                </div>
              </div>

              <div class="chartWrap">
                <div v-if="buildingHeightLoading" class="chartSpinner">
                  <div class="spinner"></div>
                </div>
                <svg class="chart" viewBox="0 0 260 130" preserveAspectRatio="none">
                  <g>
                    <line :x1="padL" :y1="plotBottom" :x2="plotRight" :y2="plotBottom" class="axis" />
                    <line :x1="padL" :y1="plotTop" :x2="padL" :y2="plotBottom" class="axis" />

                    <g v-for="t in hXTicks" :key="'hx'+t.value">
                      <line :x1="t.x" :y1="plotBottom" :x2="t.x" :y2="plotBottom + 4" class="tickLine" />
                      <text :x="t.x" :y="plotBottom + 14" text-anchor="middle" class="tickText">{{ t.value }}</text>
                    </g>

                    <g v-for="t in hYTicks" :key="'hy'+t.value">
                      <line :x1="padL - 4" :y1="t.y" :x2="padL" :y2="t.y" class="tickLine" />
                      <text :x="padL - 6" :y="t.y + 3" text-anchor="end" class="tickText">{{ t.value }}</text>
                      <line :x1="padL" :y1="t.y" :x2="plotRight" :y2="t.y" class="gridLine" />
                    </g>
                  </g>

                  <line
                      :x1="hXFromHeight(buildingHeightStats.avg)"
                      :y1="plotTop"
                      :x2="hXFromHeight(buildingHeightStats.avg)"
                      :y2="plotBottom"
                      class="avgLine"
                  />

                  <g v-for="(b, i) in hHist5" :key="'hb'+i">
                    <rect
                        :x="barX5(i)"
                        :y="plotBottom - hBarH5(b)"
                        :width="barW5"
                        :height="hBarH5(b)"
                        class="bar"
                        rx="4"
                    />
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="sTitle">Street canyon index (H/W)</div>

          <div v-if="!selected" class="muted">
            Select a point to compute canyon index.
          </div>

          <div v-else>
            <div v-if="!canyonStats || canyonStats.count === 0" class="muted">
              <span v-if="buildingHeightLoading">Loading heights...</span>
              <span v-else>No canyon data found in this area.</span>
            </div>
            <div v-else class="speedCard">
              <div class="speedTop">
                <div class="speedMetric">
                  <div class="mLabel">Average H/W</div>
                  <div class="mValue">{{ canyonStats.avg.toFixed(2) }}</div>
                </div>
                <div class="speedMeta">
                  <div class="mSmall">{{ canyonStats.count }} roads</div>
                  <div class="mSmall">min {{ canyonStats.min.toFixed(2) }} / max {{ canyonStats.max.toFixed(2) }}</div>
                </div>
              </div>
              <div class="avgHint">Class: {{ canyonClassLabel(canyonStats.avg) }}</div>
              <div class="chartWrap">
                <svg class="chart" viewBox="0 0 260 130" preserveAspectRatio="none">
                  <g>
                    <line :x1="padL" :y1="plotBottom" :x2="plotRight" :y2="plotBottom" class="axis" />
                    <line :x1="padL" :y1="plotTop" :x2="padL" :y2="plotBottom" class="axis" />

                    <g v-for="t in cXTicks" :key="'cx'+t.value">
                      <line :x1="t.x" :y1="plotBottom" :x2="t.x" :y2="plotBottom + 4" class="tickLine" />
                      <text :x="t.x" :y="plotBottom + 14" text-anchor="middle" class="tickText">{{ t.value }}</text>
                    </g>

                    <g v-for="t in cYTicks" :key="'cy'+t.value">
                      <line :x1="padL - 4" :y1="t.y" :x2="padL" :y2="t.y" class="tickLine" />
                      <text :x="padL - 6" :y="t.y + 3" text-anchor="end" class="tickText">{{ t.value }}</text>
                      <line :x1="padL" :y1="t.y" :x2="plotRight" :y2="t.y" class="gridLine" />
                    </g>
                  </g>

                  <line
                      :x1="xFromCanyonBucket(canyonStats.avg)"
                      :y1="plotTop"
                      :x2="xFromCanyonBucket(canyonStats.avg)"
                      :y2="plotBottom"
                      class="avgLine"
                  />

                  <g v-for="(b, i) in cBuckets" :key="'cb'+i">
                    <rect
                        :x="barX4(i)"
                        :y="plotBottom - cBarH4(b)"
                        :width="barW4"
                        :height="cBarH4(b)"
                        class="bar"
                        rx="4"
                    />
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="sTitle">Sub-zone density (coverage + count)</div>

          <div v-if="!selected" class="muted">
            Select a point to compute density.
          </div>

          <div v-else>
            <div v-if="!densityStats || densityStats.count === 0" class="muted">
              <span v-if="buildingLoading">Loading density...</span>
              <span v-else>No density data found in this area.</span>
            </div>
            <div v-else class="speedCard">
              <div class="speedTop">
                <div class="speedMetric">
                  <div class="mLabel">Average score</div>
                  <div class="mValue">{{ (densityStats.avg * 100).toFixed(1) }}%</div>
                </div>
                <div class="speedMeta">
                  <div class="mSmall">{{ densityStats.count }} cells</div>
                  <div class="mSmall">min {{ (densityStats.min * 100).toFixed(1) }} / max {{ (densityStats.max * 100).toFixed(1) }}</div>
                </div>
              </div>

              <div class="chartWrap">
                <svg class="chart" viewBox="0 0 260 130" preserveAspectRatio="none">
                  <g>
                    <line :x1="padL" :y1="plotBottom" :x2="plotRight" :y2="plotBottom" class="axis" />
                    <line :x1="padL" :y1="plotTop" :x2="padL" :y2="plotBottom" class="axis" />

                    <g v-for="t in dXTicks" :key="'dx'+t.value">
                      <line :x1="t.x" :y1="plotBottom" :x2="t.x" :y2="plotBottom + 4" class="tickLine" />
                      <text :x="t.x" :y="plotBottom + 14" text-anchor="middle" class="tickText">{{ t.value }}</text>
                    </g>

                    <g v-for="t in dYTicks" :key="'dy'+t.value">
                      <line :x1="padL - 4" :y1="t.y" :x2="padL" :y2="t.y" class="tickLine" />
                      <text :x="padL - 6" :y="t.y + 3" text-anchor="end" class="tickText">{{ t.value }}</text>
                      <line :x1="padL" :y1="t.y" :x2="plotRight" :y2="t.y" class="gridLine" />
                    </g>
                  </g>

                  <line
                      :x1="dXFromDensity(densityStats.avg)"
                      :y1="plotTop"
                      :x2="dXFromDensity(densityStats.avg)"
                      :y2="plotBottom"
                      class="avgLine"
                  />

                  <g v-for="(b, i) in dHist5" :key="'db'+i">
                    <rect
                        :x="barX5(i)"
                        :y="plotBottom - dBarH5(b)"
                        :width="barW5"
                        :height="dBarH5(b)"
                        class="bar"
                        rx="4"
                    />
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="sTitle">Vegetation coverage</div>

          <div v-if="!selected" class="muted">
            Select a point to compute vegetation.
          </div>

          <div v-else>
            <div v-if="vegetationError" class="error">{{ vegetationError }}</div>
            <div v-else-if="!vegetationStats" class="muted">
              <span v-if="vegetationLoading">Loading vegetation...</span>
              <span v-else>No vegetation data found in this area.</span>
            </div>
            <div v-else class="speedCard">
              <div class="speedTop">
                <div class="speedMetric">
                  <div class="mLabel">Coverage</div>
                  <div class="mValue">{{ vegetationPct }}%</div>
                </div>
                <div class="speedMeta">
                  <div class="mSmall">Samples {{ vegetationSampleCount }}</div>
                  <div class="mSmall">Source {{ vegetationSource }}</div>
                </div>
              </div>
              <div class="vegBar">
                <div class="vegFill" :style="{ width: vegetationPct + '%' }"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="sTitle">Relief (elevation)</div>

          <div v-if="!selected" class="muted">
            Select a point to compute relief.
          </div>

          <div v-else>
            <div v-if="reliefError" class="error">{{ reliefError }}</div>
            <div v-else-if="!reliefStats" class="muted">
              <span v-if="reliefLoading">Loading relief...</span>
              <span v-else>No relief data found in this area.</span>
            </div>
            <div v-else class="speedCard">
              <div class="speedTop">
                <div class="speedMetric">
                  <div class="mLabel">Average elevation</div>
                  <div class="mValue">{{ reliefMean }} m</div>
                </div>
                <div class="speedMeta">
                  <div class="mSmall">{{ reliefSampleCount }} samples</div>
                  <div class="mSmall">min {{ reliefMin }} / max {{ reliefMax }}</div>
                </div>
              </div>
              <div class="chartWrap">
                <svg class="chart" viewBox="0 0 260 130" preserveAspectRatio="none">
                  <g>
                    <line :x1="padL" :y1="plotBottom" :x2="plotRight" :y2="plotBottom" class="axis" />
                    <line :x1="padL" :y1="plotTop" :x2="padL" :y2="plotBottom" class="axis" />

                    <g v-for="t in rXTicks" :key="'rx'+t.value">
                      <line :x1="t.x" :y1="plotBottom" :x2="t.x" :y2="plotBottom + 4" class="tickLine" />
                      <text :x="t.x" :y="plotBottom + 14" text-anchor="middle" class="tickText">{{ t.value }}</text>
                    </g>

                    <g v-for="t in rYTicks" :key="'ry'+t.value">
                      <line :x1="padL - 4" :y1="t.y" :x2="padL" :y2="t.y" class="tickLine" />
                      <text :x="padL - 6" :y="t.y + 3" text-anchor="end" class="tickText">{{ t.value }}</text>
                      <line :x1="padL" :y1="t.y" :x2="plotRight" :y2="t.y" class="gridLine" />
                    </g>
                  </g>

                  <line
                      :x1="rXFromElevation(reliefStats.mean)"
                      :y1="plotTop"
                      :x2="rXFromElevation(reliefStats.mean)"
                      :y2="plotBottom"
                      class="avgLine"
                  />

                  <g v-for="(b, i) in rHist5" :key="'rb'+i">
                    <rect
                        :x="barX5(i)"
                        :y="plotBottom - rBarH5(b)"
                        :width="barW5"
                        :height="rBarH5(b)"
                        class="bar"
                        rx="4"
                    />
                  </g>
                </svg>
              </div>
              <div class="avgHint">Slope mean: {{ reliefSlope }}%</div>
            </div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="section">
          <div class="sTitle">Cache</div>
          <button
              class="actionBtn"
              type="button"
              :disabled="cacheResetting"
              @click="$emit('reset-cache')"
          >
            <span v-if="cacheResetting">Resetting cache...</span>
            <span v-else>Reset Redis cache</span>
          </button>
          <div v-if="cacheResetError" class="error">{{ cacheResetError }}</div>
          <div class="muted">
            <div v-if="cacheStatsLoading">Cache: ...</div>
            <template v-else>
              <div>Heights: {{ cacheStats.heights.count }} buildings - {{ cacheStats.heights.mb.toFixed(2) }} MB</div>
              <div>Roads: {{ cacheStats.roads.count }} zones - {{ cacheStats.roads.mb.toFixed(2) }} MB</div>
              <div>Buildings: {{ cacheStats.buildings.count }} zones - {{ cacheStats.buildings.mb.toFixed(2) }} MB</div>
              <div>Density: {{ cacheStats.density.count }} zones - {{ cacheStats.density.mb.toFixed(2) }} MB</div>
              <div>Vegetation: {{ cacheStats.vegetation.count }} zones - {{ cacheStats.vegetation.mb.toFixed(2) }} MB</div>
              <div>Relief: {{ cacheStats.relief.count }} zones - {{ cacheStats.relief.mb.toFixed(2) }} MB</div>
              <div>Total: {{ cacheStats.total.mb.toFixed(2) }} MB</div>
              <div v-if="cacheStats.exact === false">Mode: estimate</div>
            </template>
          </div>
        </div>
      </div>

      <div class="foot">
        <div v-if="anyLoading" class="progressCard">
          <div class="progressLabel">Loading data…</div>
          <div class="progressBar">
            <div class="progressFill" :style="{ width: progressPct + '%' }"></div>
          </div>
          <div class="progressPct">{{ progressPct }}%</div>
        </div>
        <div v-else class="tip">
          Click anywhere on the map to place the center marker and draw the square.
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { computed } from "vue"
import { classifyStreetCanyonIndex } from "@/utils/canyons"

const props = defineProps({
  selected: { type: Object, default: null },
  zoneSideKm: { type: Number, required: true },
  speedStats: { type: Object, default: null },
  speedLoading: { type: Boolean, default: false },
  speedError: { type: String, default: null },
  buildingStats: { type: Object, default: null },
  buildingLoading: { type: Boolean, default: false },
  buildingError: { type: String, default: null },
  buildingHeightStats: { type: Object, default: null },
  buildingHeightLoading: { type: Boolean, default: false },
  buildingHeightError: { type: String, default: null },
  canyonStats: { type: Object, default: null },
  densityStats: { type: Object, default: null },
  vegetationStats: { type: Object, default: null },
  vegetationLoading: { type: Boolean, default: false },
  vegetationError: { type: String, default: null },
  reliefStats: { type: Object, default: null },
  reliefLoading: { type: Boolean, default: false },
  reliefError: { type: String, default: null },
  anyLoading: { type: Boolean, default: false },
  loadingProgress: { type: Number, default: 0 },
  cacheResetting: { type: Boolean, default: false },
  cacheResetError: { type: String, default: null },
  cacheStats: { type: Object, default: () => ({
    exact: true,
    total: {count: 0, mb: 0},
    heights: {count: 0, mb: 0},
    roads: {count: 0, mb: 0},
    buildings: {count: 0, mb: 0},
    density: {count: 0, mb: 0},
    vegetation: {count: 0, mb: 0},
    relief: {count: 0, mb: 0}
  }) },
  cacheStatsLoading: { type: Boolean, default: false }
})

defineEmits(["update:zoneSideKm", "reset-cache"])

const padL = 34
const padR = 10
const padT = 8
const padB = 40

const plotLeft = padL
const plotRight = 260 - padR
const plotTop = padT
const plotBottom = 130 - padB

const progressPct = computed(() => Math.round((props.loadingProgress || 0) * 100))
const vegetationPct = computed(() => {
  const c = Number(props.vegetationStats?.coverage)
  if (!Number.isFinite(c)) return 0
  return Math.max(0, Math.min(100, Math.round(c * 100)))
})
const vegetationSampleCount = computed(() => {
  const n = Number(props.vegetationStats?.sampleCount)
  return Number.isFinite(n) ? n : 0
})
const vegetationSource = computed(() => {
  const src = (props.vegetationStats?.source || "").toString().toLowerCase()
  if (src === "ign") return "IGN"
  if (src === "worldcover" || src === "worldcover_cog") return "WorldCover"
  if (src === "mixed") return "Mixed"
  return "unknown"
})

const reliefMean = computed(() => formatRelief(props.reliefStats?.mean, 1))
const reliefMin = computed(() => formatRelief(props.reliefStats?.min, 0))
const reliefMax = computed(() => formatRelief(props.reliefStats?.max, 0))
const reliefSlope = computed(() => {
  const v = Number(props.reliefStats?.slopeMean)
  if (!Number.isFinite(v)) return "-"
  return (v * 100).toFixed(1)
})
const reliefSampleCount = computed(() => {
  const n = Number(props.reliefStats?.sampleCount)
  return Number.isFinite(n) ? n : 0
})

function formatRelief(value, digits) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "-"
  const d = Number.isFinite(digits) ? digits : 1
  return n.toFixed(d)
}

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
const barW4 = 34

function barX5(i) {
  const span = plotRight - plotLeft
  const step = span / 5
  return plotLeft + i * step + (step - barW5) / 2
}

function barX4(i) {
  const span = plotRight - plotLeft
  const step = span / 4
  return plotLeft + i * step + (step - barW4) / 2
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

function xFromCanyonBucket(value) {
  if (!Number.isFinite(value)) return plotLeft
  const min = 0
  const max = 2
  const clamped = Math.max(min, Math.min(max, value))
  const t = (clamped - min) / (max - min)
  const x = plotLeft + t * (plotRight - plotLeft)
  return Math.min(plotRight, Math.max(plotLeft, x))
}

const cBuckets = computed(() => {
  const b = props.canyonStats?.buckets
  if (Array.isArray(b) && b.length === 4) return b
  return [0, 0, 0, 0]
})

const cMaxBuckets = computed(() => Math.max(1, ...cBuckets.value))

function cBarH4(v) {
  const h = (v / cMaxBuckets.value) * (plotBottom - plotTop)
  return Math.max(1, Math.min(plotBottom - plotTop, h))
}

const cXTicks = computed(() => {
  const labels = ["0-0.5", "0.5-1", "1-2", ">=2"]
  return labels.map((value, i) => ({
    value,
    x: barX4(i) + barW4 / 2
  }))
})

const cYTicks = computed(() => {
  const maxY = cMaxBuckets.value
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

function bXFromArea(value) {
  if (!props.buildingStats) return plotLeft
  const min = Math.max(1, props.buildingStats.min)
  const max = Math.max(min + 1, props.buildingStats.max)
  if (value <= 0 || max <= min) return plotLeft
  const t = (Math.log10(value) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))
  const x = plotLeft + t * (plotRight - plotLeft)
  return Math.min(plotRight, Math.max(plotLeft, x))
}

const bHist5 = computed(() => {
  const h = props.buildingStats?.hist10
  if (!Array.isArray(h) || h.length !== 10) return [0, 0, 0, 0, 0]
  return [
    h[0] + h[1],
    h[2] + h[3],
    h[4] + h[5],
    h[6] + h[7],
    h[8] + h[9]
  ]
})

const bMaxHist5 = computed(() => Math.max(1, ...bHist5.value))

function bBarH5(v) {
  const h = (v / bMaxHist5.value) * (plotBottom - plotTop)
  return Math.max(1, Math.min(plotBottom - plotTop, h))
}

const bXTicks = computed(() => {
  if (!props.buildingStats) return []
  const min = Math.max(1, props.buildingStats.min)
  const max = Math.max(min + 1, props.buildingStats.max)
  if (max <= min) return [{ value: min, x: plotLeft }, { value: max, x: plotRight }]
  const n = 5
  const step = (Math.log10(max) - Math.log10(min)) / n
  const vals = []
  for (let i = 0; i <= n; i++) vals.push(Math.pow(10, Math.log10(min) + i * step))
  return vals.map(v => ({ value: Math.round(v), x: bXFromArea(v) }))
})

const bYTicks = computed(() => {
  const maxY = bMaxHist5.value
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

function hXFromHeight(value) {
  if (!props.buildingHeightStats) return plotLeft
  const min = Math.max(1, props.buildingHeightStats.min)
  const max = Math.max(min + 1, props.buildingHeightStats.max)
  if (value <= 0 || max <= min) return plotLeft
  const t = (Math.log10(value) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))
  const x = plotLeft + t * (plotRight - plotLeft)
  return Math.min(plotRight, Math.max(plotLeft, x))
}

const hHist5 = computed(() => {
  const h = props.buildingHeightStats?.hist10
  if (!Array.isArray(h) || h.length !== 10) return [0, 0, 0, 0, 0]
  return [
    h[0] + h[1],
    h[2] + h[3],
    h[4] + h[5],
    h[6] + h[7],
    h[8] + h[9]
  ]
})

const hMaxHist5 = computed(() => Math.max(1, ...hHist5.value))

function hBarH5(v) {
  const h = (v / hMaxHist5.value) * (plotBottom - plotTop)
  return Math.max(1, Math.min(plotBottom - plotTop, h))
}

const hXTicks = computed(() => {
  if (!props.buildingHeightStats) return []
  const min = Math.max(1, props.buildingHeightStats.min)
  const max = Math.max(min + 1, props.buildingHeightStats.max)
  if (max <= min) return [{ value: min, x: plotLeft }, { value: max, x: plotRight }]
  const n = 5
  const step = (Math.log10(max) - Math.log10(min)) / n
  const vals = []
  for (let i = 0; i <= n; i++) vals.push(Math.pow(10, Math.log10(min) + i * step))
  return vals.map(v => ({ value: Math.round(v), x: hXFromHeight(v) }))
})

const hYTicks = computed(() => {
  const maxY = hMaxHist5.value
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

function dXFromDensity(value) {
  if (!props.densityStats) return plotLeft
  const min = props.densityStats.min
  const max = props.densityStats.max
  if (max <= min) return plotLeft
  const t = (value - min) / (max - min)
  const x = plotLeft + t * (plotRight - plotLeft)
  return Math.min(plotRight, Math.max(plotLeft, x))
}

const dHist5 = computed(() => {
  const h = props.densityStats?.hist10
  if (!Array.isArray(h) || h.length !== 10) return [0, 0, 0, 0, 0]
  return [
    h[0] + h[1],
    h[2] + h[3],
    h[4] + h[5],
    h[6] + h[7],
    h[8] + h[9]
  ]
})

const dMaxHist5 = computed(() => Math.max(1, ...dHist5.value))

function dBarH5(v) {
  const h = (v / dMaxHist5.value) * (plotBottom - plotTop)
  return Math.max(1, Math.min(plotBottom - plotTop, h))
}

const dXTicks = computed(() => {
  if (!props.densityStats) return []
  const min = props.densityStats.min
  const max = props.densityStats.max
  if (max <= min) return [{ value: min, x: plotLeft }, { value: max, x: plotRight }]
  const n = 5
  const step = (max - min) / n
  const vals = []
  for (let i = 0; i <= n; i++) vals.push(min + i * step)
  return vals.map(v => ({ value: Math.round(v * 100), x: dXFromDensity(v) }))
})

const dYTicks = computed(() => {
  const maxY = dMaxHist5.value
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

const reliefValues = computed(() => {
  const cells = props.reliefStats?.cells
  if (!Array.isArray(cells)) return []
  return cells.map(c => Number(c?.elevation)).filter(n => Number.isFinite(n))
})

const reliefRange = computed(() => {
  const vals = reliefValues.value
  if (!vals.length) return null
  return { min: Math.min(...vals), max: Math.max(...vals) }
})

function rXFromElevation(value) {
  const range = reliefRange.value
  if (!range) return plotLeft
  const min = range.min
  const max = range.max
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return plotLeft
  const t = (value - min) / (max - min)
  const x = plotLeft + t * (plotRight - plotLeft)
  return Math.min(plotRight, Math.max(plotLeft, x))
}

const rHist10 = computed(() => {
  const vals = reliefValues.value
  if (!vals.length) return new Array(10).fill(0)
  const range = reliefRange.value
  if (!range) return new Array(10).fill(0)
  const min = range.min
  const max = range.max
  const span = max - min
  const bins = new Array(10).fill(0)
  if (!Number.isFinite(span) || span <= 0) {
    bins[0] = vals.length
    return bins
  }
  const step = span / 10
  for (const v of vals) {
    let idx = Math.floor((v - min) / step)
    if (idx < 0) idx = 0
    if (idx >= 10) idx = 9
    bins[idx]++
  }
  return bins
})

const rHist5 = computed(() => ([
  rHist10.value[0] + rHist10.value[1],
  rHist10.value[2] + rHist10.value[3],
  rHist10.value[4] + rHist10.value[5],
  rHist10.value[6] + rHist10.value[7],
  rHist10.value[8] + rHist10.value[9]
]))

const rMaxHist5 = computed(() => Math.max(1, ...rHist5.value))

function rBarH5(v) {
  const h = (v / rMaxHist5.value) * (plotBottom - plotTop)
  return Math.max(1, Math.min(plotBottom - plotTop, h))
}

const rXTicks = computed(() => {
  const range = reliefRange.value
  if (!range) return []
  const min = range.min
  const max = range.max
  if (max <= min) return [{ value: Math.round(min), x: plotLeft }, { value: Math.round(max), x: plotRight }]
  const n = 5
  const step = (max - min) / n
  const vals = []
  for (let i = 0; i <= n; i++) vals.push(min + i * step)
  return vals.map(v => ({ value: Math.round(v), x: rXFromElevation(v) }))
})

const rYTicks = computed(() => {
  const maxY = rMaxHist5.value
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

function canyonClassLabel(value) {
  const cls = classifyStreetCanyonIndex(value)
  if (cls === "open") return "open"
  if (cls === "urban") return "urban"
  if (cls === "canyon") return "street canyon"
  if (cls === "dense") return "dense canyon"
  return "unknown"
}
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
  overflow-y: auto;
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

.chartSpinner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.18);
  pointer-events: none;
}

.spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: rgba(255, 255, 255, 0.95);
  animation: spin 0.9s linear infinite;
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

.progressCard {
  padding: 10px 12px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  display: grid;
  gap: 6px;
}

.progressLabel {
  font-size: 11px;
  font-weight: 900;
  opacity: 0.75;
}

.progressBar {
  height: 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.progressFill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, rgba(88, 101, 242, 0.85), rgba(245, 197, 66, 0.9));
  transition: width 0.2s ease;
}

.progressPct {
  font-size: 11px;
  opacity: 0.7;
  text-align: right;
}

.vegBar {
  height: 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.vegFill {
  height: 100%;
  background: linear-gradient(90deg, rgba(46, 204, 113, 0.6), rgba(46, 204, 113, 0.95));
  transition: width 0.2s ease;
}

.actionBtn {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  font-weight: 800;
  padding: 10px 12px;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.15s ease;
}

.actionBtn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  transform: translateY(-1px);
}

.actionBtn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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
