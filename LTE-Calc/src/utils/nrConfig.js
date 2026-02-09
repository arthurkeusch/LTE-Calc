const BANDWIDTH_STEPS_MHZ = [10, 20, 40, 80, 100]
const SCS_STEPS_KHZ = [15, 30, 60, 120]
const SUBCARRIER_EFFICIENCY = 0.95
const FREQUENCY_OPTIONS = [
    {ghz: 0.7, label: "700 MHz"},
    {ghz: 3.5, label: "3.5 GHz"},
    {ghz: 24, label: "24 GHz"}
]

export function computeNrConfig({
    speedStats,
    buildingStats,
    buildingHeightStats,
    canyonStats,
    densityStats,
    vegetationStats,
    reliefStats,
    zoneSideKm
} = {}) {
    const mobilityScore = scoreMobility(speedStats, zoneSideKm)
    const heightScore = scoreBuildingHeight(buildingHeightStats)
    const canyonScore = scoreCanyons(canyonStats)
    const densityScore = scoreDensity(densityStats)
    const areaScore = scoreBuildingArea(buildingStats)
    const vegetationScore = normValue(vegetationStats?.coverage, 0.1, 0.6)
    const reliefScore = scoreRelief(reliefStats)

    const clutterScore = weightedAverage([
        {value: canyonScore, weight: 0.25},
        {value: heightScore, weight: 0.25},
        {value: densityScore, weight: 0.2},
        {value: vegetationScore, weight: 0.15},
        {value: reliefScore, weight: 0.1},
        {value: areaScore, weight: 0.05}
    ])

    const trafficScore = weightedAverage([
        {value: densityScore, weight: 0.45},
        {value: mobilityScore, weight: 0.25},
        {value: scoreBuildingCount(buildingStats, zoneSideKm), weight: 0.2},
        {value: scoreRoadCount(speedStats, zoneSideKm), weight: 0.1}
    ])

    if (!Number.isFinite(mobilityScore) && !Number.isFinite(clutterScore) && !Number.isFinite(trafficScore)) {
        return null
    }

    const frequency = pickFrequency({
        mobilityScore,
        clutterScore,
        trafficScore,
        vegetationScore,
        canyonScore
    })
    const bandwidthMHz = pickBandwidth(trafficScore)
    const scsDecision = pickSubcarrierSpacing(mobilityScore, clutterScore, frequency.band)
    const subcarrierSpacingKHz = scsDecision.value
    const cpDecision = pickCyclicPrefix(clutterScore, canyonScore, reliefScore, subcarrierSpacingKHz)
    const cyclicPrefix = cpDecision.value
    const subcarrierCount = estimateSubcarriers(bandwidthMHz, subcarrierSpacingKHz)
    const resourceBlocks = Math.floor(subcarrierCount / 12)

    return {
        frequencyGHz: frequency.ghz,
        frequencyLabel: frequency.label,
        bandwidthMHz,
        subcarrierSpacingKHz,
        subcarrierCount,
        resourceBlocks,
        cyclicPrefix,
        reasonFrequency: frequency.reason,
        reasonSubcarrierSpacing: scsDecision.reason,
        reasonCyclicPrefix: cpDecision.reason,
        scores: {
            mobility: mobilityScore,
            clutter: clutterScore,
            traffic: trafficScore
        }
    }
}

function pickBandwidth(score) {
    const s = Number.isFinite(score) ? score : 0.35
    if (s < 0.25) return BANDWIDTH_STEPS_MHZ[0]
    if (s < 0.45) return BANDWIDTH_STEPS_MHZ[1]
    if (s < 0.65) return BANDWIDTH_STEPS_MHZ[2]
    if (s < 0.85) return BANDWIDTH_STEPS_MHZ[3]
    return BANDWIDTH_STEPS_MHZ[4]
}

function pickSubcarrierSpacing(mobilityScore, clutterScore, band) {
    const m = Number.isFinite(mobilityScore) ? mobilityScore : 0.4
    let scs = SCS_STEPS_KHZ[0]
    let base = scs
    if (m < 0.35) scs = SCS_STEPS_KHZ[0]
    else if (m < 0.6) scs = SCS_STEPS_KHZ[1]
    else if (m < 0.8) scs = SCS_STEPS_KHZ[2]
    else scs = SCS_STEPS_KHZ[3]
    base = scs

    const c = Number.isFinite(clutterScore) ? clutterScore : 0
    let reduced = false
    if (c > 0.7 && scs > SCS_STEPS_KHZ[0]) {
        scs = SCS_STEPS_KHZ[SCS_STEPS_KHZ.indexOf(scs) - 1]
        reduced = true
    }
    if (c > 0.85 && scs > SCS_STEPS_KHZ[1]) {
        scs = SCS_STEPS_KHZ[SCS_STEPS_KHZ.indexOf(scs) - 1]
        reduced = true
    }
    const reason = buildScsReason({mobilityScore: m, clutterScore: c, base, reduced, result: scs})
    return {value: scs, reason}
}

function pickCyclicPrefix(clutterScore, canyonScore, reliefScore, scsKHz) {
    const c = Number.isFinite(clutterScore) ? clutterScore : 0
    const canyon = Number.isFinite(canyonScore) ? canyonScore : 0
    const relief = Number.isFinite(reliefScore) ? reliefScore : 0
    const scs = Number.isFinite(scsKHz) ? scsKHz : 30
    if ((c > 0.75 || canyon > 0.85 || relief > 0.75) && scs >= 60) {
        return {value: "extended", reason: "High multipath risk (clutter/canyon/relief) with high SCS, so extended CP improves robustness."}
    }
    return {value: "normal", reason: "Multipath risk is moderate; normal CP keeps better spectral efficiency."}
}

function pickFrequency({mobilityScore, clutterScore, trafficScore, vegetationScore, canyonScore} = {}) {
    const m = Number.isFinite(mobilityScore) ? mobilityScore : 0.4
    const c = Number.isFinite(clutterScore) ? clutterScore : 0.4
    const t = Number.isFinite(trafficScore) ? trafficScore : 0.4
    const v = Number.isFinite(vegetationScore) ? vegetationScore : 0
    const canyon = Number.isFinite(canyonScore) ? canyonScore : 0

    const highClutter = c >= 0.6 || v >= 0.45 || canyon >= 0.7
    const veryHighClutter = c >= 0.8 || v >= 0.6 || canyon >= 0.85
    const highTraffic = t >= 0.65
    const mediumTraffic = t >= 0.45
    const lowMobility = m <= 0.55
    const highMobility = m >= 0.75

    if (veryHighClutter || highMobility) {
        return {
            ...FREQUENCY_OPTIONS[0],
            reason: "High clutter or high mobility favors low frequency for coverage and penetration."
        }
    }
    if (!highClutter && highTraffic && lowMobility) {
        return {
            ...FREQUENCY_OPTIONS[2],
            reason: "Low clutter and high traffic allow 24 GHz to maximize capacity in a small area."
        }
    }
    if (highClutter && mediumTraffic) {
        return {
            ...FREQUENCY_OPTIONS[1],
            reason: "Urban conditions with moderate traffic fit the 3.5 GHz balance."
        }
    }
    return {
        ...FREQUENCY_OPTIONS[1],
        reason: "Default balance between coverage and capacity."
    }
}

function buildScsReason({mobilityScore, clutterScore, base, reduced, result}) {
    const mobilityText = Number.isFinite(mobilityScore) ? `mobility score ${mobilityScore.toFixed(2)}` : "unknown mobility"
    const clutterText = Number.isFinite(clutterScore) ? `clutter score ${clutterScore.toFixed(2)}` : "unknown clutter"
    const baseText = `base SCS ${base} kHz`
    if (reduced) {
        return `${mobilityText}, ${clutterText}: ${baseText} reduced to ${result} kHz for robustness.`
    }
    return `${mobilityText}, ${clutterText}: ${baseText} fits mobility and latency targets.`
}

function estimateSubcarriers(bandwidthMHz, scsKHz) {
    const bw = Number(bandwidthMHz)
    const scs = Number(scsKHz)
    if (!Number.isFinite(bw) || !Number.isFinite(scs) || bw <= 0 || scs <= 0) return 0
    const usable = (bw * 1000 * SUBCARRIER_EFFICIENCY) / scs
    const n = Math.max(12, Math.floor(usable / 12) * 12)
    return n
}

function scoreMobility(speedStats, zoneSideKm) {
    const avg = safeNumber(speedStats?.avg)
    const max = safeNumber(speedStats?.max)
    const avgScore = normValue(avg, 20, 80)
    const maxScore = normValue(max, 50, 130)
    const speedScore = weightedAverage([
        {value: avgScore, weight: 0.6},
        {value: maxScore, weight: 0.4}
    ])
    const roadScore = scoreRoadCount(speedStats, zoneSideKm)
    return weightedAverage([
        {value: speedScore, weight: 0.8},
        {value: roadScore, weight: 0.2}
    ])
}

function scoreRoadCount(speedStats, zoneSideKm) {
    const count = safeNumber(speedStats?.count)
    const areaKm2 = areaFromSide(zoneSideKm)
    if (!Number.isFinite(count) || !Number.isFinite(areaKm2) || areaKm2 <= 0) return null
    const perKm2 = count / areaKm2
    return normValue(perKm2, 20, 400)
}

function scoreBuildingCount(buildingStats, zoneSideKm) {
    const count = safeNumber(buildingStats?.count)
    const areaKm2 = areaFromSide(zoneSideKm)
    if (!Number.isFinite(count) || !Number.isFinite(areaKm2) || areaKm2 <= 0) return null
    const perKm2 = count / areaKm2
    return normValue(perKm2, 50, 800)
}

function scoreBuildingHeight(stats) {
    const avg = normValue(stats?.avg, 8, 35)
    const max = normValue(stats?.max, 15, 80)
    return weightedAverage([
        {value: avg, weight: 0.6},
        {value: max, weight: 0.4}
    ])
}

function scoreCanyons(stats) {
    const avg = normValue(stats?.avg, 0.3, 1.6)
    const max = normValue(stats?.max, 0.8, 2.5)
    return weightedAverage([
        {value: avg, weight: 0.6},
        {value: max, weight: 0.4}
    ])
}

function scoreDensity(stats) {
    const avg = normValue(stats?.avg, 0.15, 0.6)
    const max = normValue(stats?.max, 0.3, 0.9)
    return weightedAverage([
        {value: avg, weight: 0.6},
        {value: max, weight: 0.4}
    ])
}

function scoreBuildingArea(stats) {
    const avg = normValue(stats?.avg, 50, 400)
    const max = normValue(stats?.max, 200, 2000)
    return weightedAverage([
        {value: avg, weight: 0.6},
        {value: max, weight: 0.4}
    ])
}

function scoreRelief(stats) {
    const slope = safeNumber(stats?.slopeMean)
    const slopePct = Number.isFinite(slope) ? slope * 100 : null
    const slopeScore = normValue(slopePct, 2, 12)
    const min = safeNumber(stats?.min)
    const max = safeNumber(stats?.max)
    const range = Number.isFinite(min) && Number.isFinite(max) ? Math.abs(max - min) : null
    const rangeScore = normValue(range, 10, 80)
    return weightedAverage([
        {value: slopeScore, weight: 0.7},
        {value: rangeScore, weight: 0.3}
    ])
}

function areaFromSide(sideKm) {
    const side = Number(sideKm)
    if (!Number.isFinite(side) || side <= 0) return null
    return side * side
}

function normValue(value, minRef, maxRef) {
    const v = Number(value)
    if (!Number.isFinite(v)) return null
    if (!Number.isFinite(minRef) || !Number.isFinite(maxRef) || maxRef <= minRef) return null
    if (v <= minRef) return 0
    if (v >= maxRef) return 1
    return (v - minRef) / (maxRef - minRef)
}

function weightedAverage(items) {
    const list = Array.isArray(items) ? items : []
    let sum = 0
    let weightSum = 0
    for (const item of list) {
        const v = Number(item?.value)
        if (!Number.isFinite(v)) continue
        const w = Number.isFinite(Number(item?.weight)) ? Number(item.weight) : 1
        sum += v * w
        weightSum += w
    }
    if (weightSum === 0) return null
    return sum / weightSum
}

function safeNumber(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
}
