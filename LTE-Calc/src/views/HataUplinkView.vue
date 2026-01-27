<script setup>
import {ref, computed} from "vue"

const txPowerdBm = ref(23)
const freqMHz = ref(2600)
const distanceM = ref(1000)
const antennaHeightM = ref(20)
const environment = ref("dense_urban")

const sensorHeightM = ref(1.5)

const qualityThresholddBm = ref(-110)

const distanceKm = computed(() => Math.max(0.000001, Number(distanceM.value) / 1000))

const envC = computed(() => (environment.value === "dense_urban" ? 3 : 0))

const mobileCorr = computed(() => {
  const f = Math.max(1, Number(freqMHz.value))
  const hm = Math.max(0.1, Number(sensorHeightM.value))
  const lf = Math.log10(f)
  return (1.1 * lf - 0.7) * hm - (1.56 * lf - 0.8)
})

const suburbanCorr = computed(() => {
  if (environment.value !== "suburban") return 0
  const f = Math.max(1, Number(freqMHz.value))
  const x = Math.log10(f / 28)
  return -2 * x * x - 5.4
})

const lossdB = computed(() => {
  const f = Math.max(1, Number(freqMHz.value))
  const hb = Math.max(1, Number(antennaHeightM.value))
  const d = Math.max(0.000001, distanceKm.value)
  const lf = Math.log10(f)
  const lhb = Math.log10(hb)
  const ld = Math.log10(d)

  const L =
      46.3 +
      33.9 * lf -
      13.82 * lhb -
      mobileCorr.value +
      (44.9 - 6.55 * lhb) * ld +
      envC.value

  return L + suburbanCorr.value
})

const rxPowerdBm = computed(() => Number(txPowerdBm.value) - lossdB.value)

const isCovered = computed(() => rxPowerdBm.value >= Number(qualityThresholddBm.value))

const statusLabel = computed(() => {
  if (!isCovered.value) return "Low signal (Rx power below threshold)"
  return "Link OK"
})

const statusClass = computed(() => (isCovered.value ? "ok" : "bad"))

function fmt(n, d = 2) {
  const v = Number(n)
  if (!Number.isFinite(v)) return "-"
  return v.toFixed(d)
}

const coveragePct = computed(() => {
  const min = Number(qualityThresholddBm.value) - 35
  const max = Number(qualityThresholddBm.value) + 15
  const v = rxPowerdBm.value
  const p = ((v - min) / (max - min)) * 100
  return Math.max(0, Math.min(100, p))
})

const clampedFreq = computed(() => Math.max(2550, Math.min(2650, Number(freqMHz.value))))
const clampedHb = computed(() => Math.max(10, Math.min(40, Number(antennaHeightM.value))))
const clampedTx = computed(() => (Number(txPowerdBm.value) === 20 ? 20 : 23))

const fMHz = computed({
  get: () => clampedFreq.value,
  set: (v) => (freqMHz.value = Number(v))
})

const hbM = computed({
  get: () => clampedHb.value,
  set: (v) => (antennaHeightM.value = Number(v))
})

const txdBm = computed({
  get: () => clampedTx.value,
  set: (v) => (txPowerdBm.value = Number(v))
})
</script>

<template>
  <div class="page">
    <div class="topbar">
      <div class="titleBlock">
        <div class="badge">COST</div>
        <div>
          <h1>Cost Hata Uplink Received Power Simulator</h1>
        </div>
      </div>

      <div class="statusPill" :class="statusClass">
        <span class="dot"/>
        <span>{{ statusLabel }}</span>
      </div>
    </div>

    <div class="grid">
      <section class="card">
        <div class="form">
          <div class="field">
            <label>Sensor transmit power</label>
            <div class="control">
              <select v-model.number="txdBm">
                <option :value="23">23 dBm</option>
                <option :value="20">20 dBm</option>
              </select>
            </div>
          </div>

          <div class="field">
            <label>Frequency</label>
            <div class="control">
              <input type="number" v-model.number="fMHz" min="2550" max="2650" step="1"/>
              <span class="unit">MHz</span>
            </div>
          </div>

          <div class="field">
            <label>Sensor distance to antenna</label>
            <div class="control">
              <input type="number" v-model.number="distanceM" min="1" step="1"/>
              <span class="unit">m</span>
            </div>
          </div>

          <div class="field">
            <label>Antenna height</label>
            <div class="control">
              <input type="number" v-model.number="hbM" min="10" max="40" step="1"/>
              <span class="unit">m</span>
            </div>
          </div>

          <div class="field">
            <label>Environment</label>
            <div class="control">
              <select v-model="environment">
                <option value="dense_urban">Dense urban</option>
                <option value="suburban">Suburban</option>
              </select>
            </div>
          </div>

          <div class="divider"/>

          <div class="field">
            <label>Quality threshold (optional)</label>
            <div class="control">
              <input type="number" v-model.number="qualityThresholddBm" step="1"/>
              <span class="unit">dBm</span>
            </div>
          </div>

          <div class="field">
            <label>Sensor height (fixed)</label>
            <div class="control">
              <input type="number" v-model.number="sensorHeightM" step="0.1" min="0.5" max="2.0"/>
              <span class="unit">m</span>
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="cardHeader">
          <h2>Results</h2>
          <p class="muted">Computed using Cost Hata path loss model</p>
        </div>

        <div class="kpiGrid">
          <div class="kpi">
            <div class="kpiLabel">Distance</div>
            <div class="kpiValue">{{ fmt(distanceKm, 4) }} <span class="kpiUnit">km</span></div>
            <div class="kpiHint">d (km) = distance(m) / 1000</div>
          </div>

          <div class="kpi">
            <div class="kpiLabel">Mobile correction a(hm)</div>
            <div class="kpiValue">{{ fmt(mobileCorr, 2) }} <span class="kpiUnit">dB</span></div>
            <div class="kpiHint">a(hm) = (1.1log10(f)-0.7)hm − (1.56log10(f)-0.8)</div>
          </div>

          <div class="kpi">
            <div class="kpiLabel">Environment constant</div>
            <div class="kpiValue">{{ envC }} <span class="kpiUnit">dB</span></div>
            <div class="kpiHint">C = 3 (dense urban) or 0 (others)</div>
          </div>

          <div class="kpi">
            <div class="kpiLabel">Path loss</div>
            <div class="kpiValue">{{ fmt(lossdB, 2) }} <span class="kpiUnit">dB</span></div>
            <div class="kpiHint">Cost Hata (with suburban correction if selected)</div>
          </div>

          <div class="kpi">
            <div class="kpiLabel">Received power</div>
            <div class="kpiValue" :class="{ badText: !isCovered }">
              {{ fmt(rxPowerdBm, 2) }} <span class="kpiUnit">dBm</span>
            </div>
            <div class="kpiHint">Rx(dBm) = Tx(dBm) − Loss(dB)</div>
          </div>

          <div class="kpi">
            <div class="kpiLabel">Margin vs threshold</div>
            <div class="kpiValue" :class="{ badText: !isCovered }">
              {{ fmt(rxPowerdBm - qualityThresholddBm, 2) }} <span class="kpiUnit">dB</span>
            </div>
            <div class="kpiHint">Margin(dB) = Rx − Threshold</div>
          </div>
        </div>

        <div class="throughputCard" :class="{ off: !isCovered }">
          <div class="tLeft">
            <div class="tLabel">Uplink received power</div>
            <div class="tValue">
              {{ fmt(rxPowerdBm, 2) }}
              <span class="tUnit">dBm</span>
            </div>
            <div class="tSub">
              Tx: {{ txdBm }} dBm · f: {{ fMHz }} MHz · hb: {{ hbM }} m · env:
              {{ environment === "dense_urban" ? "Dense urban" : "Suburban" }}
            </div>
          </div>

          <div class="meter">
            <div class="meterTop">
              <div class="meterLabel">Coverage margin</div>
              <div class="meterValue">{{ fmt(rxPowerdBm - qualityThresholddBm, 2) }} dB</div>
            </div>
            <div class="bar">
              <div class="barFill" :style="{ width: coveragePct + '%' }"/>
            </div>
            <div class="meterSub">Threshold: {{ qualityThresholddBm }} dBm</div>
          </div>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="cardHeader">
        <h2>Cost Hata formula</h2>
        <p class="muted">
          L = 46.3 + 33.9log10(f) − 13.82log10(hb) − a(hm) + (44.9 − 6.55log10(hb))log10(d) + C
          (f in MHz, hb/hm in m, d in km)
        </p>
      </div>

      <div class="tableWrap">
        <table>
          <thead>
          <tr>
            <th>Parameter</th>
            <th>Symbol</th>
            <th>Value</th>
            <th>Unit</th>
          </tr>
          </thead>
          <tbody>
          <tr>
            <td>Frequency</td>
            <td>f</td>
            <td>{{ fmt(fMHz, 0) }}</td>
            <td>MHz</td>
          </tr>
          <tr>
            <td>Distance</td>
            <td>d</td>
            <td>{{ fmt(distanceKm, 4) }}</td>
            <td>km</td>
          </tr>
          <tr>
            <td>Base station height</td>
            <td>hb</td>
            <td>{{ fmt(hbM, 0) }}</td>
            <td>m</td>
          </tr>
          <tr>
            <td>Sensor height</td>
            <td>hm</td>
            <td>{{ fmt(sensorHeightM, 1) }}</td>
            <td>m</td>
          </tr>
          <tr>
            <td>Environment constant</td>
            <td>C</td>
            <td>{{ envC }}</td>
            <td>dB</td>
          </tr>
          <tr v-if="environment === 'suburban'">
            <td>Suburban correction</td>
            <td>Δ</td>
            <td>{{ fmt(suburbanCorr, 2) }}</td>
            <td>dB</td>
          </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 28px;
  color: rgba(255, 255, 255, 0.92);
  background: radial-gradient(900px 500px at 15% 10%, rgba(88, 101, 242, 0.35), transparent 60%),
  radial-gradient(900px 500px at 85% 35%, rgba(0, 209, 255, 0.22), transparent 60%),
  radial-gradient(900px 500px at 35% 90%, rgba(0, 255, 150, 0.18), transparent 60%),
  linear-gradient(180deg, #0b1020 0%, #070a14 100%);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji",
  "Segoe UI Emoji";
}

.topbar {
  max-width: 1180px;
  margin: 0 auto 18px auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.titleBlock {
  display: flex;
  align-items: center;
  gap: 12px;
}

.badge {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-weight: 800;
  letter-spacing: 0.6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 14px 50px rgba(0, 0, 0, 0.35);
}

h1 {
  margin: 0;
  font-size: 20px;
  line-height: 1.1;
}

.statusPill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 14px 50px rgba(0, 0, 0, 0.35);
  font-size: 13px;
  white-space: nowrap;
}

.statusPill .dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
}

.statusPill.ok .dot {
  background: rgba(0, 255, 150, 0.85);
}

.statusPill.bad .dot {
  background: rgba(255, 90, 90, 0.9);
}

.grid {
  max-width: 1180px;
  margin: 0 auto 18px auto;
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 1040px) {
  .grid {
    grid-template-columns: 1fr 1.2fr;
  }
}

.card {
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.11);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
  overflow: hidden;
}

.cardHeader {
  padding: 16px 16px 0 16px;
}

h2 {
  margin: 0;
  font-size: 14px;
  letter-spacing: 0.2px;
}

.muted {
  margin: 8px 0 0 0;
  font-size: 12px;
  opacity: 0.75;
}

.form {
  padding: 16px;
  display: grid;
  gap: 12px;
}

.field {
  display: grid;
  gap: 6px;
}

label {
  font-size: 12px;
  opacity: 0.82;
}

.control {
  position: relative;
  display: flex;
  align-items: center;
}

input,
select {
  width: 100%;
  height: 42px;
  border-radius: 14px;
  padding: 0 12px;
  color: rgba(255, 255, 255, 0.92);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  outline: none;
  transition: border 120ms ease, transform 120ms ease, background 120ms ease;
}

input:focus,
select:focus {
  border: 1px solid rgba(88, 101, 242, 0.55);
  background: rgba(0, 0, 0, 0.33);
}

.unit {
  position: absolute;
  right: 12px;
  font-size: 12px;
  opacity: 0.65;
  pointer-events: none;
}

.divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 4px 0;
}

.kpiGrid {
  padding: 16px;
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr;
}

@media (min-width: 760px) {
  .kpiGrid {
    grid-template-columns: 1fr 1fr;
  }
}

.kpi {
  border-radius: 16px;
  padding: 14px;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.11);
}

.kpiLabel {
  font-size: 12px;
  opacity: 0.72;
}

.kpiValue {
  margin-top: 6px;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.2px;
}

.kpiUnit {
  font-size: 12px;
  opacity: 0.7;
  font-weight: 700;
}

.kpiHint {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.62;
}

.badText {
  color: rgba(255, 110, 110, 0.95);
}

.throughputCard {
  margin: 0 16px 16px 16px;
  border-radius: 18px;
  padding: 14px;
  background: radial-gradient(600px 240px at 10% 20%, rgba(88, 101, 242, 0.25), transparent 70%),
  radial-gradient(600px 240px at 90% 50%, rgba(0, 209, 255, 0.18), transparent 70%),
  rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.12);
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

@media (min-width: 900px) {
  .throughputCard {
    grid-template-columns: 1.1fr 0.9fr;
    align-items: center;
  }
}

.throughputCard.off {
  filter: saturate(0.8);
}

.tLabel {
  font-size: 12px;
  opacity: 0.76;
}

.tValue {
  margin-top: 6px;
  font-size: 26px;
  font-weight: 900;
  letter-spacing: 0.2px;
}

.tUnit {
  font-size: 13px;
  opacity: 0.7;
  font-weight: 700;
}

.tSub {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.65;
}

.meterTop {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.meterLabel {
  font-size: 12px;
  opacity: 0.75;
}

.meterValue {
  font-size: 12px;
  font-weight: 800;
  opacity: 0.9;
}

.bar {
  margin-top: 10px;
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.barFill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(255, 90, 90, 0.9) 0%, rgba(255, 220, 90, 0.9) 45%, rgba(0, 255, 150, 0.9) 100%);
}

.meterSub {
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.62;
}

.tableWrap {
  padding: 16px;
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  min-width: 760px;
}

thead th {
  text-align: left;
  font-size: 12px;
  opacity: 0.8;
  padding: 12px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

tbody td {
  padding: 12px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  opacity: 0.92;
}

tbody tr {
  transition: background 120ms ease;
}

tbody tr:hover {
  background: rgba(255, 255, 255, 0.04);
}

@media (prefers-reduced-motion: reduce) {
  input,
  select,
  tbody tr {
    transition: none;
  }
}
</style>
