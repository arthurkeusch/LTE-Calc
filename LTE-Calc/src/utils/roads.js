import {areaCacheKey} from "./cacheKeys"

const OVERPASS_PRIMARY = "https://overpass-api.de/api/interpreter"
const OVERPASS_RETRIES = 3
const OVERPASS_RETRY_DELAY_MS = 500
const BACKEND_BASE_URL = "https://lte-calc.arthur-keusch.fr:3000"
const CACHE_ROADS_ENDPOINT = `${BACKEND_BASE_URL}/cache/roads`
const CACHE_ROADS_STORE_ENDPOINT = `${BACKEND_BASE_URL}/cache/roads/store`

export async function fetchRoadSpeedsInSquare(lat, lng, sideKm, signal) {
    const cacheKey = areaCacheKey(lat, lng, sideKm)
    const cached = await loadRoadsFromCache(cacheKey, signal)
    if (cached) return cached

    const {south, west, north, east} = computeSquareBounds(lat, lng, sideKm)

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
        const lanes = parseLanes(tags.lanes)
        const width = parseWidth(tags.width)
        if (Number.isFinite(s) && s > 0) {
            speeds.push(s)
            if (el.geometry) {
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
    }

    const result = {speeds, roads}
    await saveRoadsToCache(cacheKey, result, signal)
    return result
}

async function loadRoadsFromCache(cacheKey, signal) {
    if (!cacheKey) return null
    try {
        const res = await fetch(CACHE_ROADS_ENDPOINT, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({key: cacheKey}),
            signal
        })
        if (!res.ok) return null
        const json = await res.json().catch(() => ({}))
        const data = json?.data
        if (!json?.hit || !data) return null
        if (!Array.isArray(data.roads) || !Array.isArray(data.speeds)) return null
        return data
    } catch (err) {
        if (err?.name === "AbortError") throw err
        return null
    }
}

async function saveRoadsToCache(cacheKey, data, signal) {
    if (!cacheKey || !data) return
    try {
        await fetch(CACHE_ROADS_STORE_ENDPOINT, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({key: cacheKey, data}),
            signal
        })
    } catch {
        return
    }
}

function computeSquareBounds(lat, lng, sideKm) {
    const halfSideM = (Number(sideKm) * 1000) / 2
    const latRad = (lat * Math.PI) / 180
    const dLat = (halfSideM / 6378137) * (180 / Math.PI)
    const dLng = dLat / Math.cos(latRad)
    return {
        south: lat - dLat,
        north: lat + dLat,
        west: lng - dLng,
        east: lng + dLng
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
