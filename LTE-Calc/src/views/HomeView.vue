<script setup>
import {ref, computed} from "vue"

const bwMHz = ref(10)
const freqMHz = ref(800)
const cyclicPrefix = ref("normal")
const txPowerdBm = ref(20)
const distanceM = ref(300)

const qualityThresholddBm = ref(-90)
const noiseInterfdBm = ref(-100)

const rbTable = [
  {bw: 1.4, rb: 6},
  {bw: 3, rb: 15},
  {bw: 5, rb: 25},
  {bw: 10, rb: 50},
  {bw: 15, rb: 75},
  {bw: 20, rb: 100}
]

const mcsTable = [
  {index: 0, snr: 0.0, se: 0.67, modulation: "QPSK", coding: "1/3"},
  {index: 1, snr: 1.5, se: 1.0, modulation: "QPSK", coding: "1/2"},
  {index: 2, snr: 4.0, se: 1.3, modulation: "QPSK", coding: "2/3"},
  {index: 3, snr: 5.0, se: 1.5, modulation: "QPSK", coding: "3/4"},
  {index: 4, snr: 5.5, se: 1.6, modulation: "QPSK", coding: "4/5"},
  {index: 5, snr: 7.0, se: 2.0, modulation: "16QAM", coding: "1/2"},
  {index: 6, snr: 10.0, se: 2.67, modulation: "16QAM", coding: "2/3"},
  {index: 7, snr: 11.5, se: 3.0, modulation: "16QAM", coding: "3/4"},
  {index: 8, snr: 13.0, se: 3.2, modulation: "16QAM", coding: "4/5"},
  {index: 9, snr: 15.0, se: 4.0, modulation: "64QAM", coding: "2/3"},
  {index: 10, snr: 17.0, se: 4.5, modulation: "64QAM", coding: "3/4"},
  {index: 11, snr: 18.5, se: 4.8, modulation: "64QAM", coding: "4/5"},
  {index: 12, snr: 20.0, se: 5.33, modulation: "256QAM", coding: "2/3"},
  {index: 13, snr: 22.0, se: 6.0, modulation: "256QAM", coding: "3/4"},
  {index: 14, snr: 24.0, se: 6.4, modulation: "256QAM", coding: "4/5"},
  {index: 15, snr: 27.0, se: 7.0, modulation: "256QAM", coding: "7/8"}
]

const rbCount = computed(() => {
  const v = Number(bwMHz.value)
  const hit = rbTable.find(x => x.bw === v)
  if (hit) return hit.rb
  let best = rbTable[0]
  for (const x of rbTable) if (Math.abs(x.bw - v) < Math.abs(best.bw - v)) best = x
  return best.rb
})

const distanceKm = computed(() => Math.max(0.000001, Number(distanceM.value) / 1000))
const lossdB = computed(() => {
  const d = distanceKm.value
  const f = Math.max(1, Number(freqMHz.value))
  return 32.45 + 20 * Math.log10(d) + 20 * Math.log10(f)
})

const rxPowerdBm = computed(() => Number(txPowerdBm.value) - lossdB.value)
const sinrDb = computed(() => rxPowerdBm.value - Number(noiseInterfdBm.value))

const isCovered = computed(() => rxPowerdBm.value >= Number(qualityThresholddBm.value))

const selectedMcs = computed(() => {
  let chosen = mcsTable[0]
  for (const m of mcsTable) if (sinrDb.value >= m.snr) chosen = m
  return chosen
})

const cpFactor = computed(() => (cyclicPrefix.value === "extended" ? 12 / 14 : 1))

const throughputMbps = computed(() => {
  if (!isCovered.value) return 0
  const bwHz = Number(bwMHz.value) * 1e6
  const bps = bwHz * selectedMcs.value.se * cpFactor.value
  return bps / 1e6
})

const statusLabel = computed(() => {
  if (!isCovered.value) return "Out of coverage (Rx power below quality threshold)"
  return "Link OK"
})

const statusClass = computed(() => (isCovered.value ? "ok" : "bad"))

function fmt(n, d = 2) {
  const v = Number(n)
  if (!Number.isFinite(v)) return "-"
  return v.toFixed(d)
}

const coveragePct = computed(() => {
  const min = Number(qualityThresholddBm.value) - 25
  const max = Number(qualityThresholddBm.value) + 10
  const v = rxPowerdBm.value
  const p = ((v - min) / (max - min)) * 100
  return Math.max(0, Math.min(100, p))
})
</script>

<template>
  <div class="page">
    <div class="topbar">
      <div class="titleBlock">
        <div class="badge">LTE</div>
        <div>
          <h1>Useful Downlink Throughput Calculator</h1>
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
            <label>Bandwidth</label>
            <div class="control">
              <select v-model.number="bwMHz">
                <option :value="1.4">1.4 MHz</option>
                <option :value="3">3 MHz</option>
                <option :value="5">5 MHz</option>
                <option :value="10">10 MHz</option>
                <option :value="15">15 MHz</option>
                <option :value="20">20 MHz</option>
              </select>
            </div>
          </div>

          <div class="field">
            <label>Frequency band</label>
            <div class="control">
              <input type="number" v-model.number="freqMHz" min="1" step="1"/>
              <span class="unit">MHz</span>
            </div>
          </div>

          <div class="field">
            <label>Cyclic prefix</label>
            <div class="control">
              <select v-model="cyclicPrefix">
                <option value="normal">Normal</option>
                <option value="extended">Extended</option>
              </select>
            </div>
          </div>

          <div class="field">
            <label>Antenna transmit power</label>
            <div class="control">
              <input type="number" v-model.number="txPowerdBm" step="1"/>
              <span class="unit">dBm</span>
            </div>
          </div>

          <div class="field">
            <label>UE distance to antenna</label>
            <div class="control">
              <input type="number" v-model.number="distanceM" min="1" step="1"/>
              <span class="unit">m</span>
            </div>
          </div>

          <div class="divider"/>

          <div class="field">
            <label>Quality threshold</label>
            <div class="control">
              <input type="number" v-model.number="qualityThresholddBm" step="1"/>
              <span class="unit">dBm</span>
            </div>
          </div>

          <div class="field">
            <label>Noise + interference</label>
            <div class="control">
              <input type="number" v-model.number="noiseInterfdBm" step="1"/>
              <span class="unit">dBm</span>
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="cardHeader">
          <h2>Results</h2>
          <p class="muted">Computed from the given propagation model and SINR -> MCS mapping table</p>
        </div>

        <div class="kpiGrid">
          <div class="kpi">
            <div class="kpiLabel">Free-space loss</div>
            <div class="kpiValue">{{ fmt(lossdB, 2) }} <span class="kpiUnit">dB</span></div>
            <div class="kpiHint">Loss(dB) = 20log(d) + 20log(f) + 32.45</div>
          </div>

          <div class="kpi">
            <div class="kpiLabel">Received power</div>
            <div class="kpiValue" :class="{ badText: !isCovered }">
              {{ fmt(rxPowerdBm, 2) }} <span class="kpiUnit">dBm</span>
            </div>
            <div class="kpiHint">Tx(dBm) − Loss(dB)</div>
          </div>

          <div class="kpi">
            <div class="kpiLabel">SINR</div>
            <div class="kpiValue">
              {{ fmt(sinrDb, 2) }} <span class="kpiUnit">dB</span>
            </div>
            <div class="kpiHint">Rx(dBm) − (Noise + Interference)(dBm)</div>
          </div>

          <div class="kpi">
            <div class="kpiLabel">Selected MCS</div>
            <div class="kpiValue">
              #{{ selectedMcs.index }} — {{ selectedMcs.modulation }}
            </div>
            <div class="kpiHint">Coding rate: {{ selectedMcs.coding }} · SE: {{ fmt(selectedMcs.se, 2) }} bps/Hz</div>
          </div>
        </div>

        <div class="throughputCard" :class="{ off: !isCovered }">
          <div class="tLeft">
            <div class="tLabel">Useful downlink throughput</div>
            <div class="tValue">
              {{ fmt(throughputMbps, 2) }}
              <span class="tUnit">Mbps</span>
            </div>
            <div class="tSub">
              BW: {{ bwMHz }} MHz · CP factor: {{ fmt(cpFactor, 3) }} · RBs: {{ rbCount }}
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
            <div class="meterSub">
              Threshold: {{ qualityThresholddBm }} dBm · Noise+I: {{ noiseInterfdBm }} dBm
            </div>
          </div>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="cardHeader">
        <h2>SINR → Modulation & Coding mapping table</h2>
        <p class="muted">The highlighted row is the active selection based on your computed SINR</p>
      </div>

      <div class="tableWrap">
        <table>
          <thead>
          <tr>
            <th>Index</th>
            <th>SNR (dB)</th>
            <th>Spectral efficiency (bps/Hz)</th>
            <th>Modulation</th>
            <th>Coding rate</th>
          </tr>
          </thead>
          <tbody>
          <tr
              v-for="m in mcsTable"
              :key="m.index"
              :class="{ active: m.index === selectedMcs.index }"
          >
            <td>{{ m.index }}</td>
            <td>{{ fmt(m.snr, 1) }}</td>
            <td>{{ fmt(m.se, 2) }}</td>
            <td>{{ m.modulation }}</td>
            <td>{{ m.coding }}</td>
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

.subtitle {
  margin: 6px 0 0 0;
  font-size: 13px;
  opacity: 0.75;
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
  min-width: 700px;
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

tbody tr.active {
  background: rgba(88, 101, 242, 0.16);
  outline: 1px solid rgba(88, 101, 242, 0.35);
}

@media (prefers-reduced-motion: reduce) {
  input,
  select,
  tbody tr {
    transition: none;
  }
}
</style>
