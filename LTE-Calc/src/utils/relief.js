const IGN_ALTI_URL = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
const IGN_LIDAR_RESOURCE = "ign_lidar_hd_mnx_multi_wld"
const RELIEF_SAMPLE_STEP_M = 50
const RELIEF_CELL_SIZE_M = RELIEF_SAMPLE_STEP_M
const RELIEF_CACHE_VERSION = 1
const RELIEF_CACHE_BATCH = 500
const RELIEF_CACHE_STORE_BATCH = 500
const BACKEND_BASE_URL = "https://lte-calc.arthur-keusch.fr:3000"
const CACHE_RELIEF_ENDPOINT = `${BACKEND_BASE_URL}/cache/relief`
const CACHE_RELIEF_STORE_ENDPOINT = `${BACKEND_BASE_URL}/cache/relief/store`
const ALTI_BATCH_SIZE = 1000
const ALTI_MAX_CONCURRENCY = 5
const ALTI_RETRIES = 3
const ALTI_RETRY_DELAY_MS = 500

export async function fetchReliefInSquare(lat, lng, sideKm, {signal} = {}) {
    const latNum = Number(lat)
    const lngNum = Number(lng)
    const sideNum = Number(sideKm)
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) || !Number.isFinite(sideNum) || sideNum <= 0) return null

    if (!isInFrance(latNum, lngNum)) return null

    const bounds = computeSquareBounds(latNum, lngNum, sideNum)
    const cells = buildReliefCells(bounds)
    if (!cells.length) return null

    const keys = cells.map(c => c.key)
    let cached = {}
    try {
        cached = await loadReliefCellsFromCache(keys, signal)
    } catch {
    }

    for (const cell of cells) {
        const entry = cached?.[cell.key]
        if (!entry || typeof entry !== "object") continue
        const elevation = Number(entry.elevation)
        if (!Number.isFinite(elevation)) continue
        cell.elevation = elevation
        cell.cached = true
    }

    let missing = cells.filter(c => !Number.isFinite(c.elevation))
    if (missing.length) {
        await fillReliefCellsFromIgn(missing, signal)
    }

    const scored = cells.filter(c => Number.isFinite(c.elevation))
    if (!scored.length) return null

    const vals = scored.map(c => c.elevation)
    const stats = statsOf(vals)
    const slopeMean = slopeApproxFromCellGrid(scored, RELIEF_CELL_SIZE_M)

    const toStore = {}
    for (const cell of scored) {
        if (cell.cached) continue
        toStore[cell.key] = {elevation: cell.elevation}
    }
    await saveReliefCellsToCache(toStore, signal)

    return {
        source: "ign_geopf_alti",
        resolution: "LiDAR HD MNX resource",
        sampleCount: scored.length,
        min: stats.min,
        max: stats.max,
        mean: stats.mean,
        std: stats.std,
        slopeMean,
        cells: scored.map(c => ({
            bounds: c.bounds,
            elevation: c.elevation
        })),
        updatedAt: new Date().toISOString()
    }
}

function isInFrance(lat, lng) {
    return lat >= 41.0 && lat <= 51.6 && lng >= -5.5 && lng <= 9.8
}

function computeSquareBounds(lat, lng, sideKm) {
    const h = (sideKm * 1000) / 2
    const dLat = (h / 6378137) * (180 / Math.PI)
    const dLng = dLat / Math.cos((lat * Math.PI) / 180)
    return {south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng}
}

function buildReliefCells(bounds) {
    const size = RELIEF_CELL_SIZE_M
    if (!Number.isFinite(size) || size <= 0) return []
    const sw = mercatorFromLatLng(bounds.south, bounds.west)
    const ne = mercatorFromLatLng(bounds.north, bounds.east)
    const minX = Math.floor(Math.min(sw.x, ne.x) / size)
    const maxX = Math.floor(Math.max(sw.x, ne.x) / size)
    const minY = Math.floor(Math.min(sw.y, ne.y) / size)
    const maxY = Math.floor(Math.max(sw.y, ne.y) / size)
    const cells = []
    for (let iy = minY; iy <= maxY; iy++) {
        const y0 = iy * size
        const y1 = y0 + size
        const south = latFromMercatorY(y0)
        const north = latFromMercatorY(y1)
        const lat = (south + north) / 2
        for (let ix = minX; ix <= maxX; ix++) {
            const x0 = ix * size
            const x1 = x0 + size
            const west = lngFromMercatorX(x0)
            const east = lngFromMercatorX(x1)
            const lng = (west + east) / 2
            cells.push({
                key: reliefCellKey(ix, iy),
                ix,
                iy,
                bounds: [[south, west], [north, east]],
                center: {lat, lng},
                elevation: null,
                cached: false
            })
        }
    }
    return cells
}

function statsOf(arr) {
    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (const v of arr) {
        if (v < min) min = v
        if (v > max) max = v
        sum += v
    }
    const mean = sum / arr.length
    let varSum = 0
    for (const v of arr) {
        const d = v - mean
        varSum += d * d
    }
    const std = Math.sqrt(varSum / arr.length)
    return {min, max, mean, std}
}

function slopeApproxFromCellGrid(cells, stepM) {
    if (!Array.isArray(cells) || cells.length < 9) return null
    const step = Number(stepM)
    if (!Number.isFinite(step) || step <= 0) return null

    const grid = new Map()
    for (const cell of cells) {
        if (!Number.isFinite(cell?.elevation)) continue
        grid.set(`${cell.ix},${cell.iy}`, cell.elevation)
    }

    let sumSlope = 0
    let count = 0
    for (const cell of cells) {
        const c = cell?.elevation
        if (!Number.isFinite(c)) continue
        const l = grid.get(`${cell.ix - 1},${cell.iy}`)
        const r = grid.get(`${cell.ix + 1},${cell.iy}`)
        const s = grid.get(`${cell.ix},${cell.iy - 1}`)
        const n = grid.get(`${cell.ix},${cell.iy + 1}`)
        if (!Number.isFinite(l) || !Number.isFinite(r) || !Number.isFinite(s) || !Number.isFinite(n)) continue
        const dzdx = (r - l) / (2 * step)
        const dzdy = (n - s) / (2 * step)
        const slope = Math.sqrt(dzdx * dzdx + dzdy * dzdy)
        if (!Number.isFinite(slope)) continue
        sumSlope += slope
        count++
    }
    return count ? sumSlope / count : null
}

async function fetchAltimetryElevations(points, signal) {
    const out = new Array(points.length).fill(null)
    const batches = []
    for (let i = 0; i < points.length; i += ALTI_BATCH_SIZE) {
        const batch = points.slice(i, i + ALTI_BATCH_SIZE)
        batches.push({batch, offset: i})
    }

    let anySuccess = false
    let lastError = null
    await runWithConcurrencyLimit(batches, ALTI_MAX_CONCURRENCY, async ({batch, offset}) => {
        let success = false
        for (let attempt = 1; attempt <= ALTI_RETRIES; attempt++) {
            try {
                const lon = batch.map(p => p.lng).join("|")
                const lat = batch.map(p => p.lat).join("|")
                const body = {
                    lon,
                    lat,
                    resource: IGN_LIDAR_RESOURCE,
                    delimiter: "|",
                    measures: "true",
                    zonly: "false"
                }
                const res = await fetch(IGN_ALTI_URL, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify(body),
                    signal
                })
                if (!res.ok) {
                    const t = await res.text().catch(() => "")
                    throw new Error(`Altimetry error (${res.status}) ${t ? "- " + t.slice(0, 140) : ""}`.trim())
                }
                const json = await res.json().catch(() => null)
                const elevations = Array.isArray(json?.elevations) ? json.elevations : []
                for (let j = 0; j < batch.length; j++) {
                    const e = elevations[j]
                    if (!e) continue
                    const z = elevationFromAltimetry(e)
                    if (Number.isFinite(z)) out[offset + j] = z
                }
                success = true
                anySuccess = true
                break
            } catch (err) {
                if (err?.name === "AbortError") throw err
                lastError = err
                if (attempt < ALTI_RETRIES) {
                    await delay(ALTI_RETRY_DELAY_MS * attempt, signal)
                }
            }
        }
        if (!success && lastError) {
            // keep going; we fail only if all batches fail
        }
    })

    if (!anySuccess) {
        throw lastError || new Error("Failed to fetch altimetry data")
    }

    return out
}

async function loadReliefCellsFromCache(keys, signal) {
    if (!Array.isArray(keys) || keys.length === 0) return {}
    const out = {}
    for (let i = 0; i < keys.length; i += RELIEF_CACHE_BATCH) {
        const batch = keys.slice(i, i + RELIEF_CACHE_BATCH)
        try {
            const res = await fetch(CACHE_RELIEF_ENDPOINT, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({keys: batch}),
                signal
            })
            if (!res.ok) continue
            const json = await res.json().catch(() => null)
            const cells = json?.cells
            if (cells && typeof cells === "object") {
                Object.assign(out, cells)
            }
        } catch (err) {
            if (err?.name === "AbortError") throw err
        }
    }
    return out
}

async function saveReliefCellsToCache(cells, signal) {
    if (!cells || typeof cells !== "object") return
    const entries = Object.entries(cells)
    if (!entries.length) return
    for (let i = 0; i < entries.length; i += RELIEF_CACHE_STORE_BATCH) {
        const batch = Object.fromEntries(entries.slice(i, i + RELIEF_CACHE_STORE_BATCH))
        try {
            await fetch(CACHE_RELIEF_STORE_ENDPOINT, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({cells: batch}),
                signal
            })
        } catch (err) {
            if (err?.name === "AbortError") throw err
        }
    }
}

async function fillReliefCellsFromIgn(cells, signal) {
    if (!Array.isArray(cells) || cells.length === 0) return
    const points = cells.map(c => c.center)
    const elevations = await fetchAltimetryElevations(points, signal)
    for (let i = 0; i < cells.length && i < elevations.length; i++) {
        const z = elevations[i]
        if (!Number.isFinite(z)) continue
        cells[i].elevation = z
    }
}

function reliefCellKey(ix, iy) {
    return `r${RELIEF_CACHE_VERSION}:${RELIEF_CELL_SIZE_M}:${ix}:${iy}`
}

function mercatorFromLatLng(lat, lng) {
    const r = 6378137
    const latRad = (lat * Math.PI) / 180
    const lngRad = (lng * Math.PI) / 180
    const x = r * lngRad
    const y = r * Math.log(Math.tan(Math.PI / 4 + latRad / 2))
    return {x, y}
}

function lngFromMercatorX(x) {
    return (x / 6378137) * (180 / Math.PI)
}

function latFromMercatorY(y) {
    return (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI)
}

async function runWithConcurrencyLimit(items, limit, worker) {
    const max = Math.max(1, limit | 0)
    let cursor = 0
    const runners = new Array(Math.min(max, items.length)).fill(0).map(async () => {
        while (cursor < items.length) {
            const index = cursor++
            await worker(items[index])
        }
    })
    await Promise.all(runners)
}

function elevationFromAltimetry(e) {
    const measures = Array.isArray(e?.measures) ? e.measures : []
    let mnt = null
    let mns = null
    for (const m of measures) {
        const label = (m?.name ?? m?.title ?? m?.source_name ?? "").toString().toUpperCase()
        const z = Number(m?.z)
        if (!Number.isFinite(z)) continue
        if (mnt === null && label.includes("MNT")) mnt = z
        if (mns === null && label.includes("MNS")) mns = z
    }
    if (Number.isFinite(mnt)) return mnt
    const z = Number(e?.z)
    if (Number.isFinite(z)) return z
    if (Number.isFinite(mns)) return mns
    return null
}

function delay(ms, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms)
        if (signal) {
            signal.addEventListener("abort", () => {
                clearTimeout(t)
                reject(new DOMException("Aborted", "AbortError"))
            }, {once: true})
        }
    })
}
