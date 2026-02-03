<script setup>
import {RouterLink, RouterView, useRoute} from "vue-router"

const route = useRoute()
</script>

<template>
  <div class="app">
    <header class="nav">
      <div class="navInner">
        <RouterLink :to="{ name: 'home' }" class="logo">
          <img src="/favicon.ico" alt="Logo"/>
        </RouterLink>

        <nav class="links">
          <RouterLink
              :to="{ name: 'lte_throughput' }"
              class="link"
              :class="{ active: route.name === 'lte_throughput' }"
          >
            LTE Throughput
          </RouterLink>
          <RouterLink
              :to="{ name: 'hata_uplink' }"
              class="link"
              :class="{ active: route.name === 'hata_uplink' }"
          >
            Cost Hata
          </RouterLink>
          <RouterLink
              :to="{ name: 'FiveG' }"
              class="link"
              :class="{ active: route.name === 'FiveG' }"
          >
            5G NR
          </RouterLink>
        </nav>

        <div class="rightSpacer"/>
      </div>
    </header>

    <main class="content">
      <RouterView/>
    </main>
  </div>
</template>

<style>
.app {
  width: 100%;
}

.nav {
  position: sticky;
  top: 0;
  z-index: 50;
  padding: 5px 0;
  background: rgba(6, 8, 16, 0.72);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
}

.navInner {
  max-width: 1180px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.logo img {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.35);
  transition: transform 120ms ease, opacity 120ms ease;
}

.logo:hover img {
  transform: scale(1.05);
  opacity: 0.9;
}

.links {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.link {
  text-decoration: none;
  font-size: 15px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.78);
  padding: 7px 20px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  transition: background 120ms ease, border 120ms ease, transform 120ms ease, color 120ms ease;
  white-space: nowrap;
}

.link:hover {
  transform: translateY(-1px);
  color: rgba(255, 255, 255, 0.92);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
}

.link.active {
  color: rgba(255, 255, 255, 0.95);
  background: rgba(88, 101, 242, 0.16);
  border: 1px solid rgba(88, 101, 242, 0.35);
}

.rightSpacer {
  width: 32px;
}

.content {
  width: 100%;
}
</style>
