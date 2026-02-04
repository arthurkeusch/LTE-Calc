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
        const tags = el?.tags || {}
        const geometry = el.geometry.map(p => [p.lat, p.lon])
        const area = polygonAreaMeters2(geometry)
        if (Number.isFinite(area) && area > 0) {
            const height = heightFromOsmTags(tags)
            const levels = levelsFromOsmTags(tags)
            buildings.push({
                id: el.id,
                area,
                height,
                levels,
                geometry
            })
            areas.push(area)
        }
    }

    return {areas, buildings}
}

const OVERPASS_PRIMARY = "https://overpass-api.de/api/interpreter"
const OVERPASS_RETRIES = 3
const OVERPASS_RETRY_DELAY_MS = 500

const BDNB_URL_TEMPLATE =
    "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet/bbox"
const BDNB_HEIGHT_FIELD = "hauteur_mean"

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

export async function fetchBuildingHeightsInSquare(lat, lng, sideKm, signal) {
    if (!BDNB_URL_TEMPLATE) {
        throw new Error("BDNB URL template not configured")
    }

    const halfSideM = (Number(sideKm) * 1000) / 2
    const latRad = (lat * Math.PI) / 180
    const dLat = (halfSideM / 6378137) * (180 / Math.PI)
    const dLng = dLat / Math.cos(latRad)
    const south = lat - dLat
    const north = lat + dLat
    const west = lng - dLng
    const east = lng + dLng
    const baseUrl = BDNB_URL_TEMPLATE
        .replaceAll("{south}", south)
        .replaceAll("{west}", west)
        .replaceAll("{north}", north)
        .replaceAll("{east}", east)

    const [w2154, s2154] = wgs84ToLambert93(west, south)
    const [e2154, n2154] = wgs84ToLambert93(east, north)

    const params = new URLSearchParams({
        xmin: String(w2154),
        ymin: String(s2154),
        xmax: String(e2154),
        ymax: String(n2154),
        srid: "2154",
        limit: "10000"
    })
    const sep = baseUrl.includes("?") ? "&" : "?"
    const url = `${baseUrl}${sep}${params.toString()}`

    const res = await fetch(url, {
        headers: {
            Accept: "application/json"
        },
        signal
    })
    if (!res.ok) {
        const t = await res.text().catch(() => "")
        throw new Error(`BDNB error (${res.status}) ${t ? "- " + t.slice(0, 140) : ""}`.trim())
    }
    const json = await res.json()
    const items = normalizeBdnbItems(json)
    const heights = items.map(i => i.height).filter(n => Number.isFinite(n))
    return {items, heights}
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

function heightFromOsmTags(tags) {
    if (!tags) return null
    const h = tags.height || tags["building:height"]
    if (!h) return null
    const n = parseNumberFromString(h)
    return Number.isFinite(n) ? n : null
}

function levelsFromOsmTags(tags) {
    if (!tags) return null
    const l = tags["building:levels"]
    if (!l) return null
    const n = parseNumberFromString(l)
    return Number.isFinite(n) ? n : null
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

function parseNumberFromString(v) {
    if (v === null || v === undefined) return null
    if (typeof v === "number") return Number.isFinite(v) ? v : null
    if (typeof v !== "string") return null
    const s = v.trim().toLowerCase()
    const m = s.match(/(\d+(\.\d+)?)/)
    if (!m) return null
    const n = Number(m[1])
    if (!Number.isFinite(n)) return null
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

export function applyBuildingHeights(buildings, heightItems, options = {}) {
    const maxDistanceM = Number.isFinite(options.maxDistanceM) ? options.maxDistanceM : 60
    const levelHeightM = Number.isFinite(options.levelHeightM) ? options.levelHeightM : 3
    const items = (heightItems || []).filter(i => Number.isFinite(i.height))
    if (!Array.isArray(buildings) || buildings.length === 0 || items.length === 0) {
        return (buildings || []).map(b => {
            if (Number.isFinite(b.height)) return {...b}
            if (Number.isFinite(b.levels)) return {...b, height: b.levels * levelHeightM}
            return {...b, height: null}
        })
    }

    const polyItems = items.filter(i => Array.isArray(i.polygons) && i.polygons.length)
    const pointItems = items
        .filter(i => Number.isFinite(i.lat) && Number.isFinite(i.lng))
        .map(i => ({lat: i.lat, lng: i.lng, height: i.height}))

    const grid = buildSpatialGrid(pointItems, maxDistanceM)

    return buildings.map(b => {
        const centroid = centroidLatLng(b.geometry)
        let height = null

        if (centroid && polyItems.length) {
            for (const item of polyItems) {
                if (pointInPolygons(centroid, item.polygons)) {
                    height = item.height
                    break
                }
            }
        }

        if (height === null && centroid && pointItems.length) {
            height = nearestHeight(centroid, grid, maxDistanceM)
        }

        if (height === null) {
            if (Number.isFinite(b.height)) height = b.height
            else if (Number.isFinite(b.levels)) height = b.levels * levelHeightM
        }
        return {...b, height}
    })
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

function normalizeBdnbItems(json) {
    const raw = Array.isArray(json)
        ? json
        : Array.isArray(json?.features)
            ? json.features
            : Array.isArray(json?.data)
                ? json.data
                : Array.isArray(json?.results)
                    ? json.results
                    : []

    const items = []
    for (const entry of raw) {
        const props = entry?.properties || entry || {}
        const height = extractHeight(props)
        if (!Number.isFinite(height)) continue

        const geom =
            entry?.geometry ??
            props?.geometry ??
            entry?.geom ??
            props?.geom ??
            props?.geom_groupe ??
            entry?.geom_groupe
        const polygons = geojsonToPolygons(geom)
        const point = extractLatLng(props, geom)

        items.push({
            height,
            polygons,
            lat: point?.lat ?? null,
            lng: point?.lng ?? null
        })
    }

    return items
}

function extractHeight(props) {
    const candidates = []
    if (BDNB_HEIGHT_FIELD) candidates.push(BDNB_HEIGHT_FIELD)
    candidates.push(
        "hauteur",
        "height",
        "hauteur_m",
        "hauteur_metres",
        "hauteur_moyenne",
        "h_m",
        "h",
        "ht"
    )

    for (const key of candidates) {
        if (props?.[key] !== undefined && props?.[key] !== null && props?.[key] !== "") {
            const n = Number(props[key])
            if (Number.isFinite(n)) return n
        }
    }

    return null
}

function extractLatLng(props, geom) {
    const latKeys = ["lat", "latitude", "y", "y_lat", "lat_wgs84"]
    const lngKeys = ["lng", "lon", "longitude", "x", "x_lon", "lon_wgs84"]

    for (const kLat of latKeys) {
        for (const kLng of lngKeys) {
            if (props?.[kLat] !== undefined && props?.[kLng] !== undefined) {
                const lat = Number(props[kLat])
                const lng = Number(props[kLng])
                if (Number.isFinite(lat) && Number.isFinite(lng)) return {lat, lng}
            }
        }
    }

    if (geom?.type === "Point" && Array.isArray(geom?.coordinates)) {
        const [lng, lat] = geom.coordinates
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            const crsName = geom?.crs?.properties?.name || geom?.crs?.name || ""
            if (isLambert93(crsName)) {
                const [wgsLng, wgsLat] = lambert93ToWgs84(lng, lat)
                return {lat: wgsLat, lng: wgsLng}
            }
            return {lat, lng}
        }
    }

    return null
}

function geojsonToPolygons(geom) {
    if (!geom) return null
    let g = geom
    if (typeof g === "string") {
        const trimmed = g.trim()
        if (/^POLYGON/i.test(trimmed) || /^MULTIPOLYGON/i.test(trimmed)) {
            return wktToPolygons(trimmed)
        }
        try {
            g = JSON.parse(g)
        } catch {
            return null
        }
    }

    if (!g || !g.type || !Array.isArray(g.coordinates)) return null
    const crsName = g?.crs?.properties?.name || g?.crs?.name || ""
    const useLambert = isLambert93(crsName)
    if (g.type === "Polygon") {
        const ring = g.coordinates[0] || []
        return ring.length
            ? [ring.map(([lng, lat]) => {
                if (useLambert) {
                    const [wgsLng, wgsLat] = lambert93ToWgs84(lng, lat)
                    return [wgsLat, wgsLng]
                }
                return [lat, lng]
            })]
            : null
    }
    if (g.type === "MultiPolygon") {
        const polys = []
        for (const poly of g.coordinates) {
            const ring = poly?.[0] || []
            if (ring.length) {
                polys.push(ring.map(([lng, lat]) => {
                    if (useLambert) {
                        const [wgsLng, wgsLat] = lambert93ToWgs84(lng, lat)
                        return [wgsLat, wgsLng]
                    }
                    return [lat, lng]
                }))
            }
        }
        return polys.length ? polys : null
    }
    return null
}

function wktToPolygons(wkt) {
    const rings = wkt.match(/\(\([^()]+\)\)/g)
    if (!rings) return null
    const polygons = []
    for (const ring of rings) {
        const coordsText = ring.replace(/[()]/g, "")
        const coords = coordsText.split(",").map(pair => {
            const parts = pair.trim().split(/\s+/).map(Number)
            if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null
            return [parts[1], parts[0]]
        }).filter(Boolean)
        if (coords.length >= 3) polygons.push(coords)
    }
    return polygons.length ? polygons : null
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

function pointInPolygons(point, polygons) {
    if (!point || !Array.isArray(polygons)) return false
    for (const poly of polygons) {
        if (pointInPolygon(point, poly)) return true
    }
    return false
}

function pointInPolygon(point, polygon) {
    const pts = Array.isArray(polygon) ? polygon : []
    if (pts.length < 3) return false
    const x = point.lng
    const y = point.lat
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i][1]
        const yi = pts[i][0]
        const xj = pts[j][1]
        const yj = pts[j][0]
        const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
        if (intersect) inside = !inside
    }
    return inside
}

function buildSpatialGrid(items, maxDistanceM) {
    const cell = Math.max(0.0003, maxDistanceM / 111320)
    const grid = new Map()
    for (const item of items) {
        const key = gridKey(item.lat, item.lng, cell)
        if (!grid.has(key)) grid.set(key, [])
        grid.get(key).push(item)
    }
    return {grid, cell}
}

function nearestHeight(point, gridData, maxDistanceM) {
    const {grid, cell} = gridData
    const baseX = Math.floor(point.lat / cell)
    const baseY = Math.floor(point.lng / cell)
    let best = null
    let bestD = maxDistanceM

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const key = `${baseX + dx}:${baseY + dy}`
            const bucket = grid.get(key)
            if (!bucket) continue
            for (const item of bucket) {
                const d = distanceMeters(point.lat, point.lng, item.lat, item.lng)
                if (d <= bestD) {
                    bestD = d
                    best = item.height
                }
            }
        }
    }

    return best
}

function gridKey(lat, lng, cell) {
    return `${Math.floor(lat / cell)}:${Math.floor(lng / cell)}`
}

function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6378137
    const toRad = Math.PI / 180
    const x = (lng2 - lng1) * toRad * Math.cos(((lat1 + lat2) / 2) * toRad)
    const y = (lat2 - lat1) * toRad
    return Math.sqrt(x * x + y * y) * R
}

function wgs84ToLambert93(lng, lat) {
    const a = 6378137.0
    const e = 0.0818191910428158
    const lon0 = 3 * Math.PI / 180
    const n = 0.7256077650532670
    const C = 11754255.426096
    const xs = 700000.0
    const ys = 12655612.049876

    const phi = lat * Math.PI / 180
    const lambda = lng * Math.PI / 180
    const sinPhi = Math.sin(phi)
    const eSinPhi = e * sinPhi
    const t = Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - eSinPhi) / (1 + eSinPhi), e / 2)
    const r = C * Math.pow(t, n)
    const theta = n * (lambda - lon0)
    const x = xs + r * Math.sin(theta)
    const y = ys - r * Math.cos(theta)
    return [x, y]
}

function lambert93ToWgs84(x, y) {
    const n = 0.7256077650532670
    const C = 11754255.426096
    const xs = 700000.0
    const ys = 12655612.049876
    const lon0 = 3 * Math.PI / 180
    const e = 0.0818191910428158
    const a = 6378137.0

    const r = Math.sqrt((x - xs) * (x - xs) + (y - ys) * (y - ys))
    const gamma = Math.atan((x - xs) / (ys - y))
    const latIso = -1 / n * Math.log(r / C)

    let phi = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2
    let prev = 0
    let iter = 0
    while (Math.abs(phi - prev) > 1e-11 && iter < 10) {
        prev = phi
        const sinPhi = Math.sin(phi)
        const part = (1 + e * sinPhi) / (1 - e * sinPhi)
        phi = 2 * Math.atan(Math.exp(latIso) * Math.pow(part, e / 2)) - Math.PI / 2
        iter++
    }

    const lambda = lon0 + gamma / n
    const lat = phi * 180 / Math.PI
    const lng = lambda * 180 / Math.PI
    return [lng, lat]
}

function isLambert93(crsName) {
    return /2154/.test(String(crsName))
}

