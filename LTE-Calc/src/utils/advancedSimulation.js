import {
    buildMercatorCells,
    computeSquareBounds,
    mercatorCellIndex,
    mercatorFromLatLng
} from "./shared"

const SIGNAL_STEP_M = 50
const MAX_CANDIDATES = 12
const SIGNAL_THRESHOLD_DBM = -95
const BASE_TX_DBM = 43
const ANTENNA_GAIN_MIN_DB = 5
const ANTENNA_GAIN_MAX_DB = 23
const EIRP_MIN_DBM = BASE_TX_DBM + ANTENNA_GAIN_MIN_DB
const EIRP_MAX_DBM = BASE_TX_DBM + ANTENNA_GAIN_MAX_DB
const MIN_DISTANCE_KM = 0.05

const LOSS_WEIGHTS = {
    density: 18,
    vegetation: 12,
    canyon: 8,
    relief: 8,
    height: 5
}

export function computeAdvancedSimulation({
    center,
    zoneSideKm,
    nrConfig,
    densityGrid,
    densityStats,
    vegetationCells,
    vegetationStats,
    reliefCells,
    reliefStats,
    canyonStats,
    buildingHeightStats
} = {}) {
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null
    const side = Number(zoneSideKm)
    if (!Number.isFinite(side) || side <= 0) return null

    const bounds = computeSquareBounds(center.lat, center.lng, side)
    const grid = buildMercatorCells(bounds, SIGNAL_STEP_M, (ix, iy) => `s:${ix}:${iy}`)
    if (!grid.length) return null

    const densityInfo = buildCellMap(densityGrid)
    const vegetationInfo = buildCellMap(vegetationCells)
    const reliefInfo = buildCellMap(reliefCells, "elevation")
    const reliefRange = reliefInfo?.range || null

    const densityAvg = safeNumber(densityStats?.avg)
    const vegetationAvg = safeNumber(vegetationStats?.coverage)
    const canyonScore = normValue(canyonStats?.avg, 0.3, 1.6) || 0
    const heightScore = normValue(buildingHeightStats?.avg, 8, 35) || 0
    const reliefGlobal = normValue((Number(reliefStats?.slopeMean) || 0) * 100, 2, 12) || 0

    const localClutterValues = []
    for (const cell of grid) {
        const d = localScore(densityInfo, cell.center) ?? densityAvg ?? 0
        const v = localScore(vegetationInfo, cell.center) ?? vegetationAvg ?? 0
        const slope = localSlope(reliefInfo, cell.center) ?? reliefGlobal ?? 0
        const elevation = localValue(reliefInfo, cell.center, "elevation")
        const localClutter = clamp01(d * 0.6 + v * 0.4)
        const loss = d * LOSS_WEIGHTS.density +
            v * LOSS_WEIGHTS.vegetation +
            canyonScore * LOSS_WEIGHTS.canyon +
            slope * LOSS_WEIGHTS.relief +
            heightScore * LOSS_WEIGHTS.height
        cell._density = d
        cell._vegetation = v
        cell._slope = slope
        cell._elevation = elevation
        cell._loss = loss
        cell._localClutter = localClutter
        localClutterValues.push(localClutter)
    }

    const candidates = pickCandidates(grid, reliefRange, MAX_CANDIDATES)
    if (!candidates.length) return null

    const freqGHz = Number(nrConfig?.frequencyGHz) || 3.5
    const freqMHz = freqGHz * 1000
    const threshold = SIGNAL_THRESHOLD_DBM

    const results = []
    for (const candidate of candidates) {
        const lossStats = computeLossStats(candidate.center, grid, freqMHz)
        if (!lossStats) continue
        const requiredEirp = threshold + lossStats.maxLoss
        const eirp = clamp(requiredEirp, EIRP_MIN_DBM, EIRP_MAX_DBM)
        const avgSignal = eirp - lossStats.avgLoss
        const minSignal = eirp - lossStats.maxLoss
        const coverage = computeCoverage(candidate.center, grid, freqMHz, eirp, threshold)
        results.push({
            candidate,
            eirp,
            avgSignal,
            minSignal,
            coverage,
            maxLoss: lossStats.maxLoss,
            avgLoss: lossStats.avgLoss
        })
    }

    if (!results.length) return null

    const bestMin = Math.max(...results.map(r => r.minSignal))
    const minTolerance = 1
    const filtered = results.filter(r => r.minSignal >= bestMin - minTolerance)
    filtered.sort((a, b) => {
        if (b.avgSignal !== a.avgSignal) return b.avgSignal - a.avgSignal
        return b.coverage - a.coverage
    })
    const best = filtered[0]

    const clutterScore = localClutterValues.length
        ? localClutterValues.reduce((s, v) => s + v, 0) / localClutterValues.length
        : 0
    const antennaHeightM = clamp(12 + 25 * clutterScore + 4 * side, 10, 60)
    const gainDb = clamp(best.eirp - BASE_TX_DBM, ANTENNA_GAIN_MIN_DB, ANTENNA_GAIN_MAX_DB)
    const eirpDbm = BASE_TX_DBM + gainDb

    const signalGrid = []
    let minSignal = Infinity
    let maxSignal = -Infinity
    let sumSignal = 0
    let count = 0
    for (const cell of grid) {
        const loss = pathLossDb(best.candidate.center, cell.center, freqMHz) + cell._loss
        const signal = eirpDbm - loss
        signalGrid.push({bounds: cell.bounds, signal})
        if (signal < minSignal) minSignal = signal
        if (signal > maxSignal) maxSignal = signal
        sumSignal += signal
        count++
    }

    return {
        antenna: {
            lat: best.candidate.center.lat,
            lng: best.candidate.center.lng,
            heightM: antennaHeightM,
            gainDb,
            eirpDbm,
            thresholdDbm: threshold,
            coverage: best.coverage,
            avgSignal: count ? sumSignal / count : null,
            minSignal: Number.isFinite(minSignal) ? minSignal : null,
            maxSignal: Number.isFinite(maxSignal) ? maxSignal : null
        },
        signalGrid
    }
}

export function computeSignalSimulation({
    mode = "basic",
    center,
    zoneSideKm,
    nrConfig,
    densityGrid,
    densityStats,
    vegetationCells,
    vegetationStats,
    reliefCells,
    reliefStats,
    canyonStats,
    buildingHeightStats
} = {}) {
    if (mode === "advanced") {
        return computeAdvancedSimulation({
            center,
            zoneSideKm,
            nrConfig,
            densityGrid,
            densityStats,
            vegetationCells,
            vegetationStats,
            reliefCells,
            reliefStats,
            canyonStats,
            buildingHeightStats
        })
    }
    return computeBasicSimulation({
        center,
        zoneSideKm,
        nrConfig,
        densityStats,
        vegetationStats,
        reliefStats,
        canyonStats,
        buildingHeightStats
    })
}

function computeBasicSimulation({
    center,
    zoneSideKm,
    nrConfig,
    densityStats,
    vegetationStats,
    reliefStats,
    canyonStats,
    buildingHeightStats
} = {}) {
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null
    const side = Number(zoneSideKm)
    if (!Number.isFinite(side) || side <= 0) return null

    const bounds = computeSquareBounds(center.lat, center.lng, side)
    const grid = buildMercatorCells(bounds, SIGNAL_STEP_M, (ix, iy) => `s:${ix}:${iy}`)
    if (!grid.length) return null

    const densityAvg = safeNumber(densityStats?.avg) || 0
    const vegetationAvg = safeNumber(vegetationStats?.coverage) || 0
    const canyonScore = normValue(canyonStats?.avg, 0.3, 1.6) || 0
    const heightScore = normValue(buildingHeightStats?.avg, 8, 35) || 0
    const reliefScore = normValue((Number(reliefStats?.slopeMean) || 0) * 100, 2, 12) || 0
    const globalLoss = densityAvg * LOSS_WEIGHTS.density +
        vegetationAvg * LOSS_WEIGHTS.vegetation +
        canyonScore * LOSS_WEIGHTS.canyon +
        reliefScore * LOSS_WEIGHTS.relief +
        heightScore * LOSS_WEIGHTS.height

    const freqGHz = Number(nrConfig?.frequencyGHz) || 3.5
    const freqMHz = freqGHz * 1000
    const threshold = SIGNAL_THRESHOLD_DBM

    let maxLoss = -Infinity
    for (const cell of grid) {
        const loss = pathLossDb(center, cell.center, freqMHz) + globalLoss
        if (!Number.isFinite(loss)) continue
        if (loss > maxLoss) maxLoss = loss
    }
    if (!Number.isFinite(maxLoss)) return null

    const requiredEirp = threshold + maxLoss
    const eirpDbm = clamp(requiredEirp, EIRP_MIN_DBM, EIRP_MAX_DBM)
    const gainDb = clamp(eirpDbm - BASE_TX_DBM, ANTENNA_GAIN_MIN_DB, ANTENNA_GAIN_MAX_DB)

    const signalGrid = []
    let minSignal = Infinity
    let maxSignal = -Infinity
    let sumSignal = 0
    let covered = 0
    let count = 0
    for (const cell of grid) {
        const loss = pathLossDb(center, cell.center, freqMHz) + globalLoss
        if (!Number.isFinite(loss)) continue
        const signal = eirpDbm - loss
        signalGrid.push({bounds: cell.bounds, signal})
        if (signal < minSignal) minSignal = signal
        if (signal > maxSignal) maxSignal = signal
        if (signal >= threshold) covered++
        sumSignal += signal
        count++
    }

    const clutterScore = clamp01(densityAvg * 0.6 + vegetationAvg * 0.4)
    const antennaHeightM = clamp(10 + 18 * clutterScore + 3 * side, 8, 45)

    return {
        antenna: {
            lat: center.lat,
            lng: center.lng,
            heightM: antennaHeightM,
            gainDb,
            eirpDbm,
            thresholdDbm: threshold,
            coverage: count ? covered / count : 0,
            avgSignal: count ? sumSignal / count : null,
            minSignal: Number.isFinite(minSignal) ? minSignal : null,
            maxSignal: Number.isFinite(maxSignal) ? maxSignal : null
        },
        signalGrid
    }
}

function pickCandidates(grid, reliefRange, maxCandidates) {
    const scored = []
    for (const cell of grid) {
        const elevScore = reliefRange && Number.isFinite(cell._elevation)
            ? normValue(cell._elevation, reliefRange.min, reliefRange.max) ?? 0.5
            : 0.5
        const localClutter = Number.isFinite(cell._localClutter) ? cell._localClutter : 0
        const quality = elevScore - localClutter
        scored.push({cell, quality})
    }
    scored.sort((a, b) => b.quality - a.quality)
    const picked = scored.slice(0, Math.max(3, maxCandidates)).map(s => s.cell)
    return picked
}

function computeLossStats(origin, grid, freqMHz) {
    if (!origin || !grid.length) return null
    let sum = 0
    let max = -Infinity
    let count = 0
    for (const cell of grid) {
        const loss = pathLossDb(origin, cell.center, freqMHz) + cell._loss
        if (!Number.isFinite(loss)) continue
        sum += loss
        if (loss > max) max = loss
        count++
    }
    if (!count || !Number.isFinite(max)) return null
    return {avgLoss: sum / count, maxLoss: max}
}

function computeCoverage(origin, grid, freqMHz, eirpDbm, threshold) {
    let covered = 0
    let total = 0
    for (const cell of grid) {
        const loss = pathLossDb(origin, cell.center, freqMHz) + cell._loss
        if (!Number.isFinite(loss)) continue
        const signal = eirpDbm - loss
        if (signal >= threshold) covered++
        total++
    }
    return total ? covered / total : 0
}

function pathLossDb(a, b, freqMHz) {
    const dKm = Math.max(distanceKm(a, b), MIN_DISTANCE_KM)
    return 32.4 + 20 * Math.log10(dKm) + 20 * Math.log10(freqMHz)
}

function distanceKm(a, b) {
    const toRad = Math.PI / 180
    const lat1 = Number(a?.lat) * toRad
    const lat2 = Number(b?.lat) * toRad
    const dLat = lat2 - lat1
    const dLng = (Number(b?.lng) - Number(a?.lng)) * toRad
    const x = dLng * Math.cos((lat1 + lat2) / 2)
    const y = dLat
    return Math.sqrt(x * x + y * y) * 6378137 / 1000
}

function buildCellMap(cells, valueKey = "score") {
    if (!Array.isArray(cells) || cells.length === 0) return null
    const size = inferCellSize(cells)
    if (!Number.isFinite(size) || size <= 0) return null
    const map = new Map()
    let min = Infinity
    let max = -Infinity
    for (const cell of cells) {
        const b = cell?.bounds
        if (!Array.isArray(b) || b.length < 2) continue
        const lat = (Number(b[0]?.[0]) + Number(b[1]?.[0])) / 2
        const lng = (Number(b[0]?.[1]) + Number(b[1]?.[1])) / 2
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
        const idx = mercatorCellIndex(lat, lng, size)
        if (!idx) continue
        const key = `${idx.ix}:${idx.iy}`
        map.set(key, {...cell, _center: {lat, lng}})
        const v = Number(cell?.[valueKey])
        if (Number.isFinite(v)) {
            if (v < min) min = v
            if (v > max) max = v
        }
    }
    const range = Number.isFinite(min) && Number.isFinite(max) ? {min, max} : null
    return {map, size, range}
}

function inferCellSize(cells) {
    const cell = cells.find(c => Array.isArray(c?.bounds) && c.bounds.length >= 2)
    if (!cell) return null
    const south = Number(cell.bounds?.[0]?.[0])
    const west = Number(cell.bounds?.[0]?.[1])
    const north = Number(cell.bounds?.[1]?.[0])
    const east = Number(cell.bounds?.[1]?.[1])
    if (!Number.isFinite(south) || !Number.isFinite(west) || !Number.isFinite(north) || !Number.isFinite(east)) return null
    const midLat = (south + north) / 2
    const midLng = (west + east) / 2
    const m1 = mercatorFromLatLng(midLat, west)
    const m2 = mercatorFromLatLng(midLat, east)
    const m3 = mercatorFromLatLng(south, midLng)
    const m4 = mercatorFromLatLng(north, midLng)
    const dx = Math.abs(m2.x - m1.x)
    const dy = Math.abs(m4.y - m3.y)
    const size = Math.max(dx, dy)
    return Number.isFinite(size) && size > 0 ? size : null
}

function localScore(info, point) {
    const cell = localCell(info, point)
    const v = Number(cell?.score)
    return Number.isFinite(v) ? v : null
}

function localValue(info, point, key) {
    const cell = localCell(info, point)
    const v = Number(cell?.[key])
    return Number.isFinite(v) ? v : null
}

function localSlope(info, point) {
    if (!info || !info.map || !info.size) return null
    const idx = mercatorCellIndex(point.lat, point.lng, info.size)
    if (!idx) return null
    const key = (ix, iy) => `${ix}:${iy}`
    const c = info.map.get(key(idx.ix, idx.iy))
    const l = info.map.get(key(idx.ix - 1, idx.iy))
    const r = info.map.get(key(idx.ix + 1, idx.iy))
    const s = info.map.get(key(idx.ix, idx.iy - 1))
    const n = info.map.get(key(idx.ix, idx.iy + 1))
    if (!c || !l || !r || !s || !n) return null
    const zc = Number(c.elevation)
    const zl = Number(l.elevation)
    const zr = Number(r.elevation)
    const zs = Number(s.elevation)
    const zn = Number(n.elevation)
    if (![zc, zl, zr, zs, zn].every(Number.isFinite)) return null
    const dzdx = (zr - zl) / (2 * info.size)
    const dzdy = (zn - zs) / (2 * info.size)
    const slope = Math.sqrt(dzdx * dzdx + dzdy * dzdy)
    return normValue(slope * 100, 2, 12)
}

function localCell(info, point) {
    if (!info || !info.map || !info.size) return null
    const idx = mercatorCellIndex(point.lat, point.lng, info.size)
    if (!idx) return null
    return info.map.get(`${idx.ix}:${idx.iy}`) || null
}

function normValue(value, minRef, maxRef) {
    const v = Number(value)
    if (!Number.isFinite(v)) return null
    if (!Number.isFinite(minRef) || !Number.isFinite(maxRef) || maxRef <= minRef) return null
    if (v <= minRef) return 0
    if (v >= maxRef) return 1
    return (v - minRef) / (maxRef - minRef)
}

function safeNumber(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
}

function clamp(value, min, max) {
    const v = Number(value)
    if (!Number.isFinite(v)) return min
    return Math.min(max, Math.max(min, v))
}

function clamp01(value) {
    return clamp(value, 0, 1)
}
