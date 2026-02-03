<template>
  <aside class="side">
    <div class="sideInner">
      <div class="sideTop">
        <div class="badge">5G NR</div>
        <div class="title">Setting</div>
        <div class="subtitle">Pick a center point on the map</div>
      </div>

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
defineProps({
  selected: {
    type: Object,
    default: null
  },
  zoneSideKm: {
    type: Number,
    required: true
  }
})

defineEmits(['update:zoneSideKm'])
</script>

<style scoped>
.side {
  width: 10%;
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

.sideTop {
  display: grid;
  gap: 6px;
}

.badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.2px;
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
}

.title {
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0.2px;
  color: rgba(255, 255, 255, 0.94);
}

.subtitle {
  font-size: 12px;
  opacity: 0.72;
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
