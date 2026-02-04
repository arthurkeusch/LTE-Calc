export async function fetchRoadSpeedsInSquare(lat, lng, sideKm, signal) {
    const halfSideM = (Number(sideKm) * 1000) / 2
    const latRad = (lat * Math.PI) / 180
    const dLat = (halfSideM / 6378137) * (180 / Math.PI)
    const dLng = dLat / Math.cos(latRad)
    const south = lat - dLat
    const north = lat + dLat
    const west = lng - dLng
    const east = lng + dLng

    const query = `[out:json][timeout:25];
(
  way["highway"](${south},${west},${north},${east});
);
out tags geom;`

    const json = await fetchOverpassJson(query, signal)
    const els = Array.isArray(json?.elements) ? json.elements : []

    const roads = []
    const speeds = []
    for (const el of els) {
        if (el.type !== "way") continue
        const tags = el?.tags || {}
        const highway = tags.highway
        if (!highway) continue
        const s = speedFromTags(tags, highway)
        if (Number.isFinite(s) && s > 0) {
            speeds.push(s)
            if (el.geometry) {
                roads.push({
                    id: el.id,
                    speed: s,
                    geometry: el.geometry.map(p => [p.lat, p.lon])
                })
            }
        }
    }

    return {speeds, roads}
}

export async function fetchBuildingsInSquare(lat, lng, sideKm, signal) {
    const halfSideM = (Number(sideKm) * 1000) / 2
    const latRad = (lat * Math.PI) / 180
    const dLat = (halfSideM / 6378137) * (180 / Math.PI)
    const dLng = dLat / Math.cos(latRad)
    const south = lat - dLat
    const north = lat + dLat
    const west = lng - dLng
    const east = lng + dLng

    const query = `[out:json][timeout:25];
(
  way["building"](${south},${west},${north},${east});
);
out tags geom;`

    const json = await fetchOverpassJson(query, signal)
    const els = Array.isArray(json?.elements) ? json.elements : []

    const buildings = []
    const areas = []
    for (const el of els) {
        if (el.type !== "way") continue
        if (!el.geometry || el.geometry.length < 3) continue
        const geometry = el.geometry.map(p => [p.lat, p.lon])
        const area = polygonAreaMeters2(geometry)
        if (Number.isFinite(area) && area > 0) {
            buildings.push({
                id: el.id,
                area,
                geometry
            })
            areas.push(area)
        }
    }

    return {areas, buildings}
}

const BACKEND_BASE_URL = "https://lte-calc.arthur-keusch.fr:3000"
const CACHE_BUILDING_HEIGHTS_ENDPOINT = `${BACKEND_BASE_URL}/cache/building-heights`
const CACHE_BUILDING_HEIGHTS_STORE_ENDPOINT = `${BACKEND_BASE_URL}/cache/building-heights/store`
const CACHE_HEIGHTS_QUERY_BATCH = 100000

export async function loadBuildingHeightsFromCache(ids, signal, onBatch) {
    if (!Array.isArray(ids) || ids.length === 0) return {}
    const out = {}
    const batches = []
    for (let i = 0; i < ids.length; i += CACHE_HEIGHTS_QUERY_BATCH) {
        const batch = ids.slice(i, i + CACHE_HEIGHTS_QUERY_BATCH)
        batches.push({batch})
    }

    const totalBatches = batches.length || 1
    let completed = 0
    await runWithConcurrencyLimit(batches, 1, async ({batch}) => {
        try {
            const res = await fetch(CACHE_BUILDING_HEIGHTS_ENDPOINT, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({ids: batch}),
                signal
            })
            if (res.ok) {
                const json = await res.json()
                if (json?.heights && typeof json.heights === "object") {
                    Object.assign(out, json.heights)
                }
            }
        } catch {
            // ignore cache errors
        }
        completed += 1
        if (typeof onBatch === "function") {
            const progress = totalBatches ? completed / totalBatches : 1
            onBatch({...out}, progress)
        }
    })
    return out
}

export async function saveBuildingHeightsToCache(heights, signal) {
    if (!heights || typeof heights !== "object") return
    const entries = Object.entries(heights)
    if (entries.length === 0) return
    try {
        await fetch(CACHE_BUILDING_HEIGHTS_STORE_ENDPOINT, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({heights}),
            signal
        })
    } catch {
        return
    }
}

const OVERPASS_PRIMARY = "https://overpass-api.de/api/interpreter"
const OVERPASS_RETRIES = 3
const OVERPASS_RETRY_DELAY_MS = 500

const ALTI_ENDPOINT = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
const ALTI_RESOURCE_ID = "ign_lidar_hd_mnx_multi_wld"
const ALTI_BATCH_SIZE = 1000
const ALTI_MAX_CONCURRENCY = 5
const ALTI_RETRIES = 3
const ALTI_RETRY_DELAY_MS = 500

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

function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x))
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

export function computeBuildingStats(values) {
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

    const bins = 10
    const hist10 = new Array(bins).fill(0)
    const span = max - min || 1
    const step = span / bins
    for (const x of v) {
        let idx = Math.floor((x - min) / step)
        if (idx < 0) idx = 0
        if (idx >= bins) idx = bins - 1
        hist10[idx]++
    }

    return {
        count,
        min,
        max,
        avg,
        deciles: [],
        hist10
    }
}

export function computeHeightStats(values) {
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

    const bins = 10
    const hist10 = new Array(bins).fill(0)
    const span = max - min || 1
    const step = span / bins
    for (const x of v) {
        let idx = Math.floor((x - min) / step)
        if (idx < 0) idx = 0
        if (idx >= bins) idx = bins - 1
        hist10[idx]++
    }

    return {
        count,
        min,
        max,
        avg,
        deciles: [],
        hist10
    }
}

export function computeDensityStats(values) {
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

    const bins = 10
    const hist10 = new Array(bins).fill(0)
    const span = max - min || 1
    const step = span / bins
    for (const x of v) {
        let idx = Math.floor((x - min) / step)
        if (idx < 0) idx = 0
        if (idx >= bins) idx = bins - 1
        hist10[idx]++
    }

    return {
        count,
        min,
        max,
        avg,
        deciles: [],
        hist10
    }
}

export async function applyAltimetryHeights(buildings, signal, onProgress) {
    if (!Array.isArray(buildings) || buildings.length === 0) return buildings || []
    const missingIdx = []
    const points = []
    for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i]
        if (Number.isFinite(b.height)) continue
        const c = centroidLatLng(b.geometry)
        if (!c) continue
        missingIdx.push(i)
        points.push(c)
    }

    if (!points.length) return buildings

    const next = buildings.slice()
    const heights = await fetchAltimetryHeights(points, signal, (offset, batchHeights, completed, total) => {
        for (let i = 0; i < batchHeights.length; i++) {
            const idx = missingIdx[offset + i]
            const h = batchHeights[i]
            if (Number.isFinite(h) && h > 0) {
                next[idx] = {...next[idx], height: h}
            }
        }
        if (typeof onProgress === "function") {
            const progress = total ? completed / total : 1
            onProgress(next.slice(), progress)
        }
    })

    for (let i = 0; i < heights.length; i++) {
        const idx = missingIdx[i]
        const h = heights[i]
        if (Number.isFinite(h) && h > 0) {
            next[idx] = {...next[idx], height: h}
        }
    }
    return next
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

async function fetchAltimetryHeights(points, signal, onBatch) {
    const out = new Array(points.length).fill(null)
    const batches = []
    for (let i = 0; i < points.length; i += ALTI_BATCH_SIZE) {
        const batch = points.slice(i, i + ALTI_BATCH_SIZE)
        batches.push({batch, offset: i})
    }

    let completed = 0
    let anySuccess = false
    let lastError = null
    await runWithConcurrencyLimit(batches, ALTI_MAX_CONCURRENCY, async ({batch, offset}) => {
        let batchHeights = new Array(batch.length).fill(null)
        let success = false
        for (let attempt = 1; attempt <= ALTI_RETRIES; attempt++) {
            try {
                const lon = batch.map(p => p.lng).join("|")
                const lat = batch.map(p => p.lat).join("|")
                const body = {
                    lon,
                    lat,
                    resource: ALTI_RESOURCE_ID,
                    delimiter: "|",
                    measures: "true",
                    zonly: "false"
                }
                const res = await fetch(ALTI_ENDPOINT, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify(body),
                    signal
                })
                if (!res.ok) {
                    const t = await res.text().catch(() => "")
                    throw new Error(`Altimetry error (${res.status}) ${t ? "- " + t.slice(0, 140) : ""}`.trim())
                }
                const json = await res.json()
                const elevations = Array.isArray(json?.elevations) ? json.elevations : []
                batchHeights = new Array(batch.length).fill(null)
                for (let j = 0; j < batch.length; j++) {
                    const e = elevations[j]
                    if (!e) continue
                    const h = heightFromAltimetry(e)
                    if (Number.isFinite(h)) {
                        out[offset + j] = h
                        batchHeights[j] = h
                    }
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
        completed += 1
        if (typeof onBatch === "function") {
            onBatch(offset, batchHeights, completed, batches.length)
        }
        if (!success && lastError) {
            // continue without throwing: we only fail if all batches fail
        }
    })
    if (!anySuccess) {
        throw lastError || new Error("Failed to fetch altimetry data")
    }
    return out
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

function heightFromAltimetry(e) {
    const measures = Array.isArray(e?.measures) ? e.measures : []
    if (!measures.length) return null
    let mnh = null
    let mns = null
    let mnt = null
    for (const m of measures) {
        const label = (m?.name ?? m?.title ?? m?.source_name ?? "").toString().toUpperCase()
        const z = Number(m?.z)
        if (!Number.isFinite(z)) continue
        if (mnh === null && label.includes("MNH")) mnh = z
        if (mns === null && label.includes("MNS")) mns = z
        if (mnt === null && label.includes("MNT")) mnt = z
    }
    if (Number.isFinite(mnh)) return mnh
    if (Number.isFinite(mns) && Number.isFinite(mnt)) return mns - mnt
    return null
}

function polygonAreaMeters2(latlngs) {
    const pts = Array.isArray(latlngs) ? latlngs : []
    if (pts.length < 3) return 0

    const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length
    const lat0Rad = (lat0 * Math.PI) / 180
    const toRad = Math.PI / 180
    const R = 6378137

    let area = 0
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        const ax = a[1] * toRad * Math.cos(lat0Rad) * R
        const ay = a[0] * toRad * R
        const bx = b[1] * toRad * Math.cos(lat0Rad) * R
        const by = b[0] * toRad * R
        area += ax * by - bx * ay
    }

    return Math.abs(area) / 2
}

function centroidLatLng(geometry) {
    const pts = Array.isArray(geometry) ? geometry : []
    if (!pts.length) return null
    let sumLat = 0
    let sumLng = 0
    for (const p of pts) {
        sumLat += p[0]
        sumLng += p[1]
    }
    return {lat: sumLat / pts.length, lng: sumLng / pts.length}
}


function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6378137
    const toRad = Math.PI / 180
    const x = (lng2 - lng1) * toRad * Math.cos(((lat1 + lat2) / 2) * toRad)
    const y = (lat2 - lat1) * toRad
    return Math.sqrt(x * x + y * y) * R
}
