const OVERPASS_PRIMARY = "https://overpass-api.de/api/interpreter"
import {areaCacheKey} from "./cacheKeys"
import {computeSquareBounds, delay, runWithConcurrencyLimit} from "./shared"

const OVERPASS_RETRIES = 3
const OVERPASS_RETRY_DELAY_MS = 500
const BACKEND_BASE_URL = "https://lte-calc.arthur-keusch.fr:3000"
const CACHE_BUILDING_HEIGHTS_ENDPOINT = `${BACKEND_BASE_URL}/cache/building-heights`
const CACHE_BUILDING_HEIGHTS_STORE_ENDPOINT = `${BACKEND_BASE_URL}/cache/building-heights/store`
const CACHE_BUILDING_HEIGHTS_RESET_ENDPOINT = `${BACKEND_BASE_URL}/cache/building-heights/reset`
const CACHE_BUILDINGS_ENDPOINT = `${BACKEND_BASE_URL}/cache/buildings`
const CACHE_BUILDINGS_STORE_ENDPOINT = `${BACKEND_BASE_URL}/cache/buildings/store`
const CACHE_DENSITY_ENDPOINT = `${BACKEND_BASE_URL}/cache/density`
const CACHE_DENSITY_STORE_ENDPOINT = `${BACKEND_BASE_URL}/cache/density/store`
const CACHE_STATS_ENDPOINT = `${BACKEND_BASE_URL}/cache/stats`
const CACHE_HEIGHTS_QUERY_BATCH = 100000

const ALTI_ENDPOINT = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
const ALTI_RESOURCE_ID = "ign_lidar_hd_mnx_multi_wld"
const ALTI_BATCH_SIZE = 1000
const ALTI_MAX_CONCURRENCY = 5
const ALTI_RETRIES = 3
const ALTI_RETRY_DELAY_MS = 500

export async function fetchBuildingsInSquare(lat, lng, sideKm, signal) {
    const cacheKey = areaCacheKey(lat, lng, sideKm)
    const cached = await loadBuildingsFromCache(cacheKey, signal)
    if (cached) return cached

    const {south, west, north, east} = computeSquareBounds(lat, lng, sideKm)

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

    const result = {areas, buildings}
    await saveBuildingsToCache(cacheKey, result, signal)
    return result
}

async function loadBuildingsFromCache(cacheKey, signal) {
    if (!cacheKey) return null
    try {
        const res = await fetch(CACHE_BUILDINGS_ENDPOINT, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({key: cacheKey}),
            signal
        })
        if (!res.ok) return null
        const json = await res.json().catch(() => ({}))
        const data = json?.data
        if (!json?.hit || !data) return null
        if (!Array.isArray(data.buildings) || !Array.isArray(data.areas)) return null
        return data
    } catch (err) {
        if (err?.name === "AbortError") throw err
        return null
    }
}

async function saveBuildingsToCache(cacheKey, data, signal) {
    if (!cacheKey || !data) return
    try {
        await fetch(CACHE_BUILDINGS_STORE_ENDPOINT, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({key: cacheKey, data}),
            signal
        })
    } catch {
        return
    }
}

export async function loadDensityFromCache(cacheKey, signal) {
    if (!cacheKey) return null
    try {
        const res = await fetch(CACHE_DENSITY_ENDPOINT, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({key: cacheKey}),
            signal
        })
        if (!res.ok) return null
        const json = await res.json().catch(() => ({}))
        const data = json?.data
        if (!json?.hit || !data) return null
        if (!Array.isArray(data.cells)) return null
        return data
    } catch (err) {
        if (err?.name === "AbortError") throw err
        return null
    }
}

export async function saveDensityToCache(cacheKey, data, signal) {
    if (!cacheKey || !data) return
    try {
        await fetch(CACHE_DENSITY_STORE_ENDPOINT, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({key: cacheKey, data}),
            signal
        })
    } catch {
        return
    }
}

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

export async function resetBuildingHeightsCache(signal) {
    const res = await fetch(CACHE_BUILDING_HEIGHTS_RESET_ENDPOINT, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        signal
    })
    if (!res.ok) {
        const t = await res.text().catch(() => "")
        throw new Error(`Cache reset error (${res.status}) ${t ? "- " + t.slice(0, 140) : ""}`.trim())
    }
    return await res.json().catch(() => ({}))
}

export async function fetchCacheStats(signal) {
    const res = await fetch(CACHE_STATS_ENDPOINT, {
        method: "GET",
        headers: {"Content-Type": "application/json"},
        signal
    })
    if (!res.ok) {
        const t = await res.text().catch(() => "")
        throw new Error(`Cache stats error (${res.status}) ${t ? "- " + t.slice(0, 140) : ""}`.trim())
    }
    return await res.json().catch(() => ({}))
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
    let next = buildings.slice()
    const newHeights = {}
    const cacheIds = []
    for (let i = 0; i < next.length; i++) {
        const b = next[i]
        const current = Number(b?.height)
        if (Number.isFinite(current)) continue
        if (b?.id === undefined || b?.id === null) continue
        cacheIds.push(b.id)
    }
    if (cacheIds.length) {
        const uniqueIds = Array.from(new Set(cacheIds))
        const cachedHeights = await loadBuildingHeightsFromCache(uniqueIds, signal)
        if (cachedHeights && typeof cachedHeights === "object") {
            next = next.map((b) => {
                const current = Number(b?.height)
                if (Number.isFinite(current)) return b
                const cached = cachedHeights?.[b.id]
                const cachedNum = Number(cached)
                if (Number.isFinite(cachedNum)) return {...b, height: cachedNum}
                return b
            })
            if (typeof onProgress === "function") {
                onProgress(next.slice(), 0)
            }
        }
    }
    const missingIdx = []
    const points = []
    const firstPoints = new Map()
    for (let i = 0; i < next.length; i++) {
        const b = next[i]
        const current = Number(b?.height)
        if (Number.isFinite(current)) continue
        const c = pickPointInsidePolygon(b.geometry)
        if (!c) continue
        missingIdx.push(i)
        points.push(c)
        firstPoints.set(i, c)
    }

    if (!points.length) return next

    const heights = await fetchAltimetryHeights(points, signal, (offset, batchHeights, completed, total) => {
        for (let i = 0; i < batchHeights.length; i++) {
            const idx = missingIdx[offset + i]
            const h = batchHeights[i]
            if (Number.isFinite(h) && h > 0) {
                next[idx] = {...next[idx], height: h}
                const id = next[idx]?.id
                if (id !== undefined && id !== null) newHeights[id] = h
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
            const id = next[idx]?.id
            if (id !== undefined && id !== null) newHeights[id] = h
        }
    }

    const retryPoints = []
    const retryMap = []
    for (let i = 0; i < missingIdx.length; i++) {
        const idx = missingIdx[i]
        const b = next[idx]
        const current = Number(b?.height)
        const area = Number.isFinite(b?.area) ? b.area : polygonAreaMeters2(b?.geometry)
        const maxPoints = Math.max(1, Math.floor(area / 10))
        if (!Number.isFinite(area) || maxPoints <= 1) continue
        if (Number.isFinite(current) && current >= 3) continue
        const first = firstPoints.get(idx)
        const candidates = buildInteriorPoints(b?.geometry, maxPoints, first)
        if (candidates.length <= 1) continue
        for (let c = 1; c < candidates.length; c++) {
            retryPoints.push(candidates[c])
            retryMap.push(idx)
        }
    }

    if (retryPoints.length) {
        const extraHeights = await fetchAltimetryHeights(retryPoints, signal)
        const best = new Map()
        for (let i = 0; i < extraHeights.length; i++) {
            const idx = retryMap[i]
            const h = extraHeights[i]
            if (!Number.isFinite(h) || h <= 0) continue
            const prev = best.get(idx)
            if (!Number.isFinite(prev) || h > prev) best.set(idx, h)
        }
        for (const [idx, h] of best.entries()) {
            const current = Number(next[idx]?.height)
            if (!Number.isFinite(current) || h > current) {
                next[idx] = {...next[idx], height: h}
                const id = next[idx]?.id
                if (id !== undefined && id !== null) newHeights[id] = h
            }
        }
        if (typeof onProgress === "function") {
            onProgress(next.slice(), 1)
        }
    }
    const newEntries = Object.entries(newHeights)
    if (newEntries.length) {
        try {
            await saveBuildingHeightsToCache(newHeights, signal)
        } catch {
            // ignore cache save errors
        }
    }
    return next
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

export function polygonAreaMeters2(latlngs) {
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

function pickPointInsidePolygon(geometry) {
    const pts = Array.isArray(geometry) ? geometry : []
    if (pts.length < 3) return null
    const centroid = polygonCentroidLatLng(pts)
    if (centroid && pointInPolygon(centroid, pts, false)) return centroid
    const avg = averageLatLng(pts)
    if (avg && pointInPolygon(avg, pts, false)) return avg
    const strictCandidates = collectInteriorPoints(pts, 16, false)
    if (strictCandidates.length) return strictCandidates[0]
    if (centroid && pointInPolygon(centroid, pts, true)) return centroid
    if (avg && pointInPolygon(avg, pts, true)) return avg
    const looseCandidates = collectInteriorPoints(pts, 8, true)
    if (looseCandidates.length) return looseCandidates[0]
    for (const p of pts) {
        const candidate = {lat: p[0], lng: p[1]}
        if (pointInPolygon(candidate, pts, true)) return candidate
    }
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        const mid = {lat: (a[0] + b[0]) / 2, lng: (a[1] + b[1]) / 2}
        if (pointInPolygon(mid, pts, true)) return mid
    }
    return null
}

function collectInteriorPoints(pts, maxPoints, allowBoundary = true) {
    const points = []
    if (!Array.isArray(pts) || pts.length < 3) return points
    if (!Number.isFinite(maxPoints) || maxPoints <= 0) return points
    const bounds = polygonBounds(pts)
    if (!bounds) return points
    const {minLat, maxLat, minLng, maxLng} = bounds
    const spanLat = maxLat - minLat
    const spanLng = maxLng - minLng
    if (!Number.isFinite(spanLat) || !Number.isFinite(spanLng) || spanLat === 0 || spanLng === 0) {
        return points
    }
    const n = Math.max(2, Math.ceil(Math.sqrt(maxPoints * 1.5)))
    for (let iy = 0; iy < n; iy++) {
        for (let ix = 0; ix < n; ix++) {
            if (points.length >= maxPoints) return points
            const lat = minLat + ((iy + 0.5) / n) * spanLat
            const lng = minLng + ((ix + 0.5) / n) * spanLng
            const p = {lat, lng}
            if (pointInPolygon(p, pts, allowBoundary)) points.push(p)
        }
    }
    if (points.length >= maxPoints) return points
    for (let i = 0; i < pts.length && points.length < maxPoints; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        const mid = {lat: (a[0] + b[0]) / 2, lng: (a[1] + b[1]) / 2}
        if (pointInPolygon(mid, pts, allowBoundary)) points.push(mid)
    }
    return points
}

function buildInteriorPoints(geometry, maxPoints, first) {
    const pts = Array.isArray(geometry) ? geometry : []
    if (pts.length < 3) return []
    const points = []
    const firstPoint = first || pickPointInsidePolygon(pts)
    if (firstPoint) points.push(firstPoint)
    if (maxPoints <= points.length) return points
    const extra = collectInteriorPoints(pts, maxPoints - points.length, true)
    for (const p of extra) {
        points.push(p)
        if (points.length >= maxPoints) break
    }
    return points
}

function polygonBounds(pts) {
    if (!pts.length) return null
    let minLat = pts[0][0]
    let maxLat = pts[0][0]
    let minLng = pts[0][1]
    let maxLng = pts[0][1]
    for (const p of pts) {
        if (p[0] < minLat) minLat = p[0]
        if (p[0] > maxLat) maxLat = p[0]
        if (p[1] < minLng) minLng = p[1]
        if (p[1] > maxLng) maxLng = p[1]
    }
    return {minLat, maxLat, minLng, maxLng}
}

function averageLatLng(pts) {
    let sumLat = 0
    let sumLng = 0
    for (const p of pts) {
        sumLat += p[0]
        sumLng += p[1]
    }
    return {lat: sumLat / pts.length, lng: sumLng / pts.length}
}

function polygonCentroidLatLng(pts) {
    let twiceArea = 0
    let cx = 0
    let cy = 0
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        const x0 = a[1]
        const y0 = a[0]
        const x1 = b[1]
        const y1 = b[0]
        const cross = x0 * y1 - x1 * y0
        twiceArea += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    }
    if (Math.abs(twiceArea) < 1e-12) return averageLatLng(pts)
    const inv = 1 / (3 * twiceArea)
    return {lat: cy * inv, lng: cx * inv}
}

function pointInPolygon(point, pts, allowBoundary = true) {
    const x = point.lng
    const y = point.lat
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i][1]
        const yi = pts[i][0]
        const xj = pts[j][1]
        const yj = pts[j][0]
        if (pointOnSegment(x, y, xi, yi, xj, yj)) return allowBoundary
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        if (intersect) inside = !inside
    }
    return inside
}

function pointOnSegment(x, y, x1, y1, x2, y2) {
    const eps = 1e-12
    const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)
    if (Math.abs(cross) > eps) return false
    const dot = (x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)
    if (dot < -eps) return false
    const len2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)
    if (dot - len2 > eps) return false
    return true
}
