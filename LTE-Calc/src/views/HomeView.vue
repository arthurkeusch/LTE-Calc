<script setup>
import {useRouter} from "vue-router"

const router = useRouter()

function goLte() {
  router.push({name: "lte_throughput"})
}

function goHata() {
  router.push({name: "hata_uplink"})
}

function goNr() {
  router.push({name: "FiveG"})
}
</script>

<template>
  <div class="home">
    <div class="container">
      <h1>Wireless Network Simulators</h1>
      <p class="subtitle">
        Select the simulation you want to explore
      </p>

      <div class="cards">
        <div class="card" @click="goLte">
          <div class="badge">LTE</div>
          <h2>LTE Throughput Simulator</h2>
          <p>
            Free-space propagation model with SINR-based MCS selection and
            useful downlink throughput computation.
          </p>
          <span class="cta">Open simulator →</span>
        </div>

        <div class="card" @click="goHata">
          <div class="badge">Cost Hata</div>
          <h2>Cost Hata Uplink Simulator</h2>
          <p>
            Uplink received power estimation using Cost Hata model for
            urban and suburban environments.
          </p>
          <span class="cta">Open simulator →</span>
        </div>

        <div class="card" @click="goNr">
          <div class="badge">5G NR</div>
          <h2>5G NR Setting Simulator</h2>
          <p>
            Area-based 5G NR configuration tool selecting frequency band,
            sub-carrier spacing and cyclic prefix according to mobility,
            density and environment.
          </p>
          <span class="cta">Open simulator →</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: radial-gradient(900px 500px at 20% 10%, rgba(88, 101, 242, 0.35), transparent 60%),
  radial-gradient(900px 500px at 80% 40%, rgba(0, 209, 255, 0.22), transparent 60%),
  linear-gradient(180deg, #0b1020 0%, #070a14 100%);
  color: rgba(255, 255, 255, 0.92);
}

.container {
  max-width: 900px;
  padding: 32px;
  text-align: center;
}

h1 {
  margin: 0;
  font-size: 28px;
}

.subtitle {
  margin-top: 8px;
  font-size: 14px;
  opacity: 0.7;
}

.cards {
  margin-top: 32px;
  display: grid;
  gap: 20px;
}

@media (min-width: 720px) {
  .cards {
    grid-template-columns: repeat(3, 1fr);
  }
}

.card {
  cursor: pointer;
  padding: 24px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  text-align: left;
  transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
}

.card:hover {
  transform: translateY(-4px);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}

.badge {
  display: inline-block;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.4px;
  background: rgba(255, 255, 255, 0.12);
  margin-bottom: 10px;
}

h2 {
  margin: 0;
  font-size: 18px;
}

p {
  margin-top: 8px;
  font-size: 13px;
  opacity: 0.75;
}

.cta {
  display: inline-block;
  margin-top: 12px;
  font-size: 12px;
  font-weight: 700;
  opacity: 0.8;
}
</style>
