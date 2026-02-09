import {
    boundsFromCells,
    buildMercatorCells,
    clipPolylineToBounds,
    computeSquareBounds,
    delay,
    mercatorCellIndex,
    runWithConcurrencyLimit
} from "./shared"

const OVERPASS_PRIMARY = "https://overpass-api.de/api/interpreter"
const OVERPASS_RETRIES = 3
const OVERPASS_RETRY_DELAY_MS = 500
const ROAD_CELL_SIZE_M = 1000
const ROAD_CACHE_VERSION = 1
const ROAD_CACHE_BATCH = 500
const ROAD_CACHE_STORE_BATCH = 500
const ROAD_CACHE_CONCURRENCY = 4
const BACKEND_BASE_URL = "https://lte-calc.arthur-keusch.fr:3000"
const CACHE_ROADS_ENDPOINT = `${BACKEND_BASE_URL}/cache/roads`
const CACHE_ROADS_STORE_ENDPOINT = `${BACKEND_BASE_URL}/cache/roads/store`

export async function fetchRoadSpeedsInSquare(lat, lng, sideKm, signal) {
    const {south, west, north, east} = computeSquareBounds(lat, lng, sideKm)
    const cells = buildRoadCells({south, west, north, east})
    if (!cells.length) return {speeds: [], roads: []}

    const keys = cells.map(c => c.key)
    let cached = {}
    try {
        cached = await loadRoadCellsFromCache(keys, signal)
    } catch (err) {
        if (err?.name === "AbortError") throw err
    }

    for (const cell of cells) {
        const entry = cached?.[cell.key]
        if (!entry || typeof entry !== "object") continue
        if (Array.isArray(entry.roads)) {
            cell.roads = entry.roads
            cell.cached = true
        }
    }

    const missing = cells.filter(c => !Array.isArray(c.roads))
    if (missing.length) {
        await fillRoadCellsFromOverpass(missing, signal)
    }

    const toStore = {}
    for (const cell of cells) {
        if (cell.cached) continue
        if (!Array.isArray(cell.roads)) cell.roads = []
        toStore[cell.key] = {roads: cell.roads}
    }
    await saveRoadCellsToCache(toStore, signal)

    const roadMap = new Map()
    for (const cell of cells) {
        for (const road of cell.roads || []) {
            if (!road || road.id === undefined || road.id === null) continue
            if (!roadMap.has(road.id)) roadMap.set(road.id, road)
        }
    }
    const bounds = {south, west, north, east}
    const roads = []
    for (const road of roadMap.values()) {
        const clipped = clipPolylineToBounds(road.geometry, bounds)
        if (!Array.isArray(clipped) || clipped.length < 2) continue
        roads.push({...road, geometry: clipped})
    }
    const speeds = roads.map(r => r.speed).filter(n => Number.isFinite(n))
    return {speeds, roads}
}

function buildRoadCells(bounds) {
    const cells = buildMercatorCells(bounds, ROAD_CELL_SIZE_M, roadCellKey)
    return cells.map(c => ({...c, roads: null, cached: false}))
}

async function loadRoadCellsFromCache(keys, signal) {
    if (!Array.isArray(keys) || keys.length === 0) return {}
    const out = {}
    const batches = []
    for (let i = 0; i < keys.length; i += ROAD_CACHE_BATCH) {
        batches.push(keys.slice(i, i + ROAD_CACHE_BATCH))
    }
    await runWithConcurrencyLimit(batches, ROAD_CACHE_CONCURRENCY, async (batch) => {
        try {
            const res = await fetch(CACHE_ROADS_ENDPOINT, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({keys: batch}),
                signal
            })
            if (!res.ok) return
            const json = await res.json().catch(() => null)
            const cells = json?.cells
            if (cells && typeof cells === "object") {
                Object.assign(out, cells)
            }
        } catch (err) {
            if (err?.name === "AbortError") throw err
        }
    })
    return out
}

async function saveRoadCellsToCache(cells, signal) {
    if (!cells || typeof cells !== "object") return
    const entries = Object.entries(cells)
    if (!entries.length) return
    const batches = []
    for (let i = 0; i < entries.length; i += ROAD_CACHE_STORE_BATCH) {
        batches.push(Object.fromEntries(entries.slice(i, i + ROAD_CACHE_STORE_BATCH)))
    }
    await runWithConcurrencyLimit(batches, ROAD_CACHE_CONCURRENCY, async (batch) => {
        try {
            await fetch(CACHE_ROADS_STORE_ENDPOINT, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({cells: batch}),
                signal
            })
        } catch (err) {
            if (err?.name === "AbortError") throw err
        }
    })
}

async function fillRoadCellsFromOverpass(cells, signal) {
    if (!Array.isArray(cells) || cells.length === 0) return
    const bounds = boundsFromCells(cells)
    if (!bounds) {
        for (const cell of cells) cell.roads = []
        return
    }
    const query = `[out:json][timeout:25];
(
  way["highway"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out tags geom;`

    const json = await fetchOverpassJson(query, signal)
    const els = Array.isArray(json?.elements) ? json.elements : []
    const roads = []
    for (const el of els) {
        if (el.type !== "way") continue
        const tags = el?.tags || {}
        const highway = tags.highway
        if (!highway) continue
        const s = speedFromTags(tags, highway)
        const lanes = parseLanes(tags.lanes)
        const width = parseWidth(tags.width)
        if (Number.isFinite(s) && s > 0 && Array.isArray(el.geometry)) {
            roads.push({
                id: el.id,
                speed: s,
                geometry: el.geometry.map(p => [p.lat, p.lon]),
                lanes,
                width,
                highway
            })
        }
    }

    const cellMap = new Map(cells.map(cell => [cell.key, cell]))
    for (const cell of cells) cell.roads = []
    for (const road of roads) {
        const keys = roadCellKeys(road.geometry)
        for (const key of keys) {
            const cell = cellMap.get(key)
            if (cell) cell.roads.push(road)
        }
    }
}

async function fetchOverpassJson(query, signal) {
    let lastError = null
    const urls = [OVERPASS_PRIMARY]

    for (const url of urls) {
        for (let attempt = 1; attempt <= OVERPASS_RETRIES; attempt++) {
            try {
                const res = await fetch(url, {
                    method: "POST",
                    headers: {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
                    body: "data=" + encodeURIComponent(query),
                    signal
                })

                if (!res.ok) {
                    const t = await res.text().catch(() => "")
                    throw new Error(`Overpass error (${res.status}) ${t ? "- " + t.slice(0, 140) : ""}`.trim())
                }

                return await res.json()
            } catch (err) {
                if (err?.name === "AbortError") throw err
                lastError = err
                if (attempt < OVERPASS_RETRIES) {
                    await delay(OVERPASS_RETRY_DELAY_MS * attempt, signal)
                }
            }
        }
    }

    throw lastError || new Error("Failed to fetch Overpass data")
}

function speedFromTags(tags, highway) {
    const ms = tags.maxspeed
    const parsed = parseMaxspeed(ms)
    if (Number.isFinite(parsed)) return clamp(parsed, 10, 130)

    const defaults = {
        motorway: 130,
        motorway_link: 90,
        trunk: 110,
        trunk_link: 80,
        primary: 80,
        primary_link: 70,
        secondary: 80,
        secondary_link: 60,
        tertiary: 50,
        tertiary_link: 40,
        residential: 30,
        living_street: 20,
        service: 20,
        unclassified: 50
    }

    const d = defaults[highway]
    if (Number.isFinite(d)) return d
    return 30
}

function parseMaxspeed(v) {
    if (!v) return null
    if (typeof v !== "string") return null
    const s = v.trim().toLowerCase()

    const m = s.match(/(\d+(\.\d+)?)/)
    if (!m) return null
    const n = Number(m[1])
    if (!Number.isFinite(n)) return null

    if (s.includes("mph")) return n * 1.60934
    return n
}

function parseLanes(v) {
    if (v === undefined || v === null) return null
    if (Number.isFinite(v)) return v > 0 ? Number(v) : null
    if (typeof v !== "string") return null
    const m = v.match(/(\d+(\.\d+)?)/g)
    if (!m || m.length === 0) return null
    const sum = m.reduce((acc, s) => {
        const n = Number(s)
        return Number.isFinite(n) ? acc + n : acc
    }, 0)
    return sum > 0 ? sum : null
}

function parseWidth(v) {
    if (v === undefined || v === null) return null
    if (Number.isFinite(v)) return v > 0 ? Number(v) : null
    if (typeof v !== "string") return null
    const s = v.trim().toLowerCase()
    const m = s.match(/(\d+(\.\d+)?)/)
    if (!m) return null
    const n = Number(m[1])
    if (!Number.isFinite(n) || n <= 0) return null
    if (s.includes("cm")) return n / 100
    if (s.includes("mm")) return n / 1000
    if (s.includes("ft")) return n * 0.3048
    return n
}

function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x))
}

function roadCellKey(ix, iy) {
    return `rd${ROAD_CACHE_VERSION}:${ROAD_CELL_SIZE_M}:${ix}:${iy}`
}

function roadCellIndex(lat, lng) {
    const idx = mercatorCellIndex(lat, lng, ROAD_CELL_SIZE_M)
    if (!idx) return null
    return {...idx, key: roadCellKey(idx.ix, idx.iy)}
}

function roadCellKeys(geometry) {
    const keys = new Set()
    const pts = Array.isArray(geometry) ? geometry : []
    for (const p of pts) {
        const idx = roadCellIndex(p[0], p[1])
        if (idx?.key) keys.add(idx.key)
    }
    return keys
}

export function computeSpeedStats(values) {
    const v = (values || []).filter(n => Number.isFinite(n)).slice().sort((a, b) => a - b)
    const count = v.length
    if (count === 0) {
        return {
            count: 0,
            min: 0,
            max: 0,
            avg: 0,
            deciles: [],
            hist10: []
        }
    }

    const min = v[0]
    const max = v[count - 1]
    const avg = v.reduce((s, x) => s + x, 0) / count

    const deciles = []
    for (let i = 1; i <= 9; i++) deciles.push(percentileSorted(v, i / 10))

    const edges = [min, ...deciles, max]
    const hist10 = new Array(10).fill(0)
    for (const x of v) {
        let idx = 9
        for (let i = 0; i < 10; i++) {
            const a = edges[i]
            const b = edges[i + 1]
            const last = i === 9
            if ((x >= a && x < b) || (last && x <= b)) {
                idx = i
                break
            }
        }
        hist10[idx]++
    }

    return {
        count,
        min,
        max,
        avg,
        deciles,
        hist10
    }
}

function percentileSorted(arr, p) {
    const n = arr.length
    if (n === 0) return 0
    const x = (n - 1) * p
    const lo = Math.floor(x)
    const hi = Math.ceil(x)
    if (lo === hi) return arr[lo]
    const w = x - lo
    return arr[lo] * (1 - w) + arr[hi] * w
}
