import {fromUrl} from "geotiff"
import {computeSquareBounds, delay, runWithConcurrencyLimit} from "./shared"

const BACKEND_BASE_URL = "https://lte-calc.arthur-keusch.fr:3000"
const CACHE_VEGETATION_ENDPOINT = `${BACKEND_BASE_URL}/cache/vegetation`
const CACHE_VEGETATION_STORE_ENDPOINT = `${BACKEND_BASE_URL}/cache/vegetation/store`
const VEGETATION_CELL_SIZE_M = 50
const VEGETATION_CACHE_VERSION = 2
const VEGETATION_CACHE_BATCH = 5000
const VEGETATION_CACHE_STORE_BATCH = 5000

const IGN_WFS_URL = "https://data.geopf.fr/wfs/ows"
const IGN_WFS_LAYERS = ["BDTOPO_V3:zone_de_vegetation"]
const IGN_MAX_FEATURES = 2000
const IGN_SRSNAME = "urn:ogc:def:crs:OGC:1.3:CRS84"

const WORLDCOVER_S3_BASE = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map"
const WORLDCOVER_VEG_CLASSES = new Set([10, 20, 30, 40, 90, 95, 100])
const WORLDCOVER_RETRIES = 2
const WORLDCOVER_RETRY_DELAY_MS = 250
const WORLDCOVER_CONCURRENCY = 4

export async function fetchVegetationInSquare(lat, lng, sideKm, signal) {
    const bounds = computeSquareBounds(lat, lng, sideKm)
    const cells = buildVegetationCells(bounds)
    if (!cells.length) return null

    const keys = cells.map(c => c.key)
    let cached = {}
    try {
        cached = await loadVegetationCellsFromCache(keys, signal)
    } catch {
    }

    for (const cell of cells) {
        const entry = cached?.[cell.key]
        if (!entry || typeof entry !== "object") continue
        const score = Number(entry.score)
        if (!Number.isFinite(score)) continue
        cell.score = score
        if (Number.isFinite(Number(entry.class))) cell.class = Number(entry.class)
        if (entry.source) cell.source = String(entry.source)
        cell.cached = true
    }

    let missing = cells.filter(c => !Number.isFinite(c.score))
    if (missing.length) {
        if (isInFrance(lat, lng)) {
            const ok = await fillIgnVegetationCells(missing, signal)
            if (!ok) {
                // fallback below
            }
        }
        missing = cells.filter(c => !Number.isFinite(c.score))
        if (missing.length) {
            await fillWorldCoverVegetationCells(missing, signal)
        }
    }

    const scored = cells.filter(c => Number.isFinite(c.score))
    if (!scored.length) return null

    const coverage = scored.reduce((s, c) => s + Number(c.score || 0), 0) / scored.length
    const sampleCount = scored.length
    const source = deriveVegetationSource(scored)

    const toStore = {}
    for (const cell of cells) {
        if (cell.cached || !Number.isFinite(cell.score)) continue
        const entry = {score: cell.score}
        if (Number.isFinite(cell.class)) entry.class = cell.class
        if (cell.source) entry.source = cell.source
        toStore[cell.key] = entry
    }
    await saveVegetationCellsToCache(toStore, signal)

    return {
        source,
        coverage,
        sampleCount,
        cells: cells.map(c => ({
            bounds: c.bounds,
            score: c.score,
            class: c.class
        })),
        updatedAt: new Date().toISOString()
    }
}

async function loadVegetationCellsFromCache(keys, signal) {
    if (!Array.isArray(keys) || keys.length === 0) return {}
    const out = {}
    for (let i = 0; i < keys.length; i += VEGETATION_CACHE_BATCH) {
        const batch = keys.slice(i, i + VEGETATION_CACHE_BATCH)
        try {
            const res = await fetch(CACHE_VEGETATION_ENDPOINT, {
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

async function saveVegetationCellsToCache(cells, signal) {
    if (!cells || typeof cells !== "object") return
    const entries = Object.entries(cells)
    if (!entries.length) return
    for (let i = 0; i < entries.length; i += VEGETATION_CACHE_STORE_BATCH) {
        const batch = Object.fromEntries(entries.slice(i, i + VEGETATION_CACHE_STORE_BATCH))
        try {
            await fetch(CACHE_VEGETATION_STORE_ENDPOINT, {
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

function isInFrance(lat, lng) {
    const latNum = Number(lat)
    const lngNum = Number(lng)
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return false
    return latNum >= 41.0 && latNum <= 51.6 && lngNum >= -5.5 && lngNum <= 9.8
}

async function fillIgnVegetationCells(cells, signal) {
    if (!Array.isArray(cells) || cells.length === 0) return false
    const bounds = boundsFromCells(cells)
    const samplesPerSide = cellSampleCountPerSide(true)
    for (const layer of IGN_WFS_LAYERS) {
        const url = buildIgnWfsUrl(bounds, layer)
        const res = await fetch(url, {signal})
        if (!res.ok) continue
        let json = null
        try {
            json = await res.json()
        } catch {
        }
        if (!Array.isArray(json?.features)) continue
        const polygons = extractPolygons(json.features)
        if (!polygons.length) {
            for (const cell of cells) {
                cell.score = 0
                cell.source = "ign"
            }
            return true
        }
        const indexed = indexPolygons(polygons)
        for (const cell of cells) {
            const samples = cellSamplePoints(cell, samplesPerSide)
            if (!samples.length) continue
            let hits = 0
            for (const p of samples) {
                if (pointInAnyIndexedPolygon(p.lng, p.lat, indexed)) hits++
            }
            cell.score = hits / samples.length
            cell.source = "ign"
        }
        return true
    }
    return false
}

async function fillWorldCoverVegetationCells(cells, signal) {
    if (!Array.isArray(cells) || cells.length === 0) return 0
    const tileCache = new Map()
    const samplesPerSide = cellSampleCountPerSide(false)
    await runWithConcurrencyLimit(cells, WORLDCOVER_CONCURRENCY, async (cell) => {
        const samples = cellSamplePoints(cell, samplesPerSide)
        if (!samples.length) return
        let hits = 0
        let total = 0
        const counts = {}
        for (const p of samples) {
            const cls = await fetchWorldCoverClassFromCog(p, tileCache, signal)
            if (!Number.isFinite(cls)) continue
            total++
            const rounded = Math.round(cls)
            counts[rounded] = (counts[rounded] || 0) + 1
            if (WORLDCOVER_VEG_CLASSES.has(rounded)) hits++
        }
        if (!total) return
        cell.score = hits / total
        const dominant = dominantClass(counts)
        if (Number.isFinite(dominant)) cell.class = dominant
        cell.source = "worldcover_cog"
    })
    return cells.filter(c => Number.isFinite(c.score)).length
}

async function fetchWorldCoverClassFromCog(point, tileCache, signal) {
    const lat = Number(point.lat)
    const lng = Number(point.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

    for (let i = 0; i < WORLDCOVER_RETRIES; i++) {
        try {
            const tile = worldCoverTileForLatLng(lat, lng)
            const info = await getWorldCoverTileInfo(tile, tileCache, signal)
            const v = await sampleWorldCoverClass(info, lat, lng)
            if (Number.isFinite(v)) return v
        } catch (e) {
            if (e?.name === "AbortError") throw e
            await delay(WORLDCOVER_RETRY_DELAY_MS * (i + 1), signal)
        }
    }
    return null
}

function worldCoverTileForLatLng(lat, lng) {
    const latDeg = Math.floor(lat)
    const lngDeg = Math.floor(lng)
    return `${latDeg >= 0 ? "N" : "S"}${String(Math.abs(latDeg)).padStart(2, "0")}${lngDeg >= 0 ? "E" : "W"}${String(Math.abs(lngDeg)).padStart(3, "0")}`
}

function worldCoverCogUrl(tile) {
    return `${WORLDCOVER_S3_BASE}/ESA_WorldCover_10m_2021_v200_${tile}_Map.tif`
}

async function getWorldCoverTileInfo(tile, tileCache, signal) {
    if (tileCache.has(tile)) return tileCache.get(tile)

    const tiff = await fromUrl(worldCoverCogUrl(tile), {
        fetch: (u, i = {}) => fetch(u, {...i, signal})
    })

    const image = await tiff.getImage()
    const info = {
        image,
        bbox: image.getBoundingBox(),
        width: image.getWidth(),
        height: image.getHeight()
    }
    tileCache.set(tile, info)
    return info
}

async function sampleWorldCoverClass({image, bbox, width, height}, lat, lng) {
    const [minX, minY, maxX, maxY] = bbox
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) return null

    const px = Math.min(width - 1, Math.max(0, Math.floor(((lng - minX) / (maxX - minX)) * width)))
    const py = Math.min(height - 1, Math.max(0, Math.floor(((maxY - lat) / (maxY - minY)) * height)))

    const rasters = await image.readRasters({
        window: [px, py, px + 1, py + 1],
        samples: [0],
        interleave: true
    })

    const v = Number(rasters?.[0])
    return Number.isFinite(v) && v > 0 ? v : null
}

function buildIgnWfsUrl({south, west, north, east}, layer) {
    const p = new URLSearchParams({
        SERVICE: "WFS",
        VERSION: "2.0.0",
        REQUEST: "GetFeature",
        TYPENAMES: layer,
        OUTPUTFORMAT: "application/json",
        SRSNAME: IGN_SRSNAME,
        BBOX: `${west},${south},${east},${north},${IGN_SRSNAME}`,
        COUNT: String(IGN_MAX_FEATURES)
    })
    return `${IGN_WFS_URL}?${p.toString()}`
}

function extractPolygons(features) {
    const out = []
    for (const f of features) {
        const g = f?.geometry
        if (!g) continue
        const type = g.type
        const coords = g.coordinates
        if (!coords) continue
        if (type === "Polygon") {
            const poly = normalizePolygon(coords)
            if (poly) out.push(poly)
        } else if (type === "MultiPolygon") {
            for (const p of coords) {
                const poly = normalizePolygon(p)
                if (poly) out.push(poly)
            }
        }
    }
    return out
}

function indexPolygons(polygons) {
    const indexed = []
    for (const ring of polygons || []) {
        const bounds = polygonBounds(ring)
        if (!bounds) continue
        indexed.push({ring, bounds})
    }
    return indexed
}

function pointInAnyIndexedPolygon(x, y, indexed) {
    for (const poly of indexed || []) {
        const b = poly.bounds
        if (!b) continue
        if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue
        if (pointInPolygon(x, y, poly.ring)) return true
    }
    return false
}

function normalizePolygon(coords) {
    if (!Array.isArray(coords) || !Array.isArray(coords[0])) return null
    const outer = coords[0]
    if (!Array.isArray(outer) || outer.length < 3) return null
    const ring = []
    for (const pt of outer) {
        const x = Number(pt?.[0])
        const y = Number(pt?.[1])
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        ring.push([x, y])
    }
    if (ring.length < 3) return null
    return ring
}

function polygonBounds(ring) {
    if (!Array.isArray(ring) || ring.length === 0) return null
    let minX = ring[0][0]
    let maxX = ring[0][0]
    let minY = ring[0][1]
    let maxY = ring[0][1]
    for (const pt of ring) {
        const x = pt[0]
        const y = pt[1]
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
    }
    return {minX, maxX, minY, maxY}
}

function buildVegetationCells(bounds) {
    const {south, west, north, east} = bounds
    if (!Number.isFinite(south) || !Number.isFinite(west) || !Number.isFinite(north) || !Number.isFinite(east)) {
        return []
    }
    const sw = mercatorFromLatLng(south, west)
    const ne = mercatorFromLatLng(north, east)
    const xMin = Math.min(sw.x, ne.x)
    const xMax = Math.max(sw.x, ne.x)
    const yMin = Math.min(sw.y, ne.y)
    const yMax = Math.max(sw.y, ne.y)
    const size = VEGETATION_CELL_SIZE_M
    const ixMin = Math.floor(xMin / size)
    const ixMax = Math.floor((xMax - 1e-6) / size)
    const iyMin = Math.floor(yMin / size)
    const iyMax = Math.floor((yMax - 1e-6) / size)
    const cells = []
    for (let iy = iyMin; iy <= iyMax; iy++) {
        for (let ix = ixMin; ix <= ixMax; ix++) {
            cells.push(buildCellFromIndex(ix, iy))
        }
    }
    return cells
}

function buildCellFromIndex(ix, iy) {
    const size = VEGETATION_CELL_SIZE_M
    const x0 = ix * size
    const x1 = x0 + size
    const y0 = iy * size
    const y1 = y0 + size
    const west = lngFromMercatorX(x0)
    const east = lngFromMercatorX(x1)
    const south = latFromMercatorY(y0)
    const north = latFromMercatorY(y1)
    return {
        key: vegetationCellKey(ix, iy),
        ix,
        iy,
        bounds: [[south, west], [north, east]],
        lat: (south + north) / 2,
        lng: (west + east) / 2,
        score: null,
        cached: false
    }
}

function cellSampleCountPerSide(preferFine = false) {
    if (preferFine) {
        if (VEGETATION_CELL_SIZE_M <= 10) return 5
        if (VEGETATION_CELL_SIZE_M <= 20) return 4
        if (VEGETATION_CELL_SIZE_M <= 50) return 3
        return 2
    }
    if (VEGETATION_CELL_SIZE_M <= 10) return 3
    if (VEGETATION_CELL_SIZE_M <= 50) return 2
    return 2
}

function cellSamplePoints(cell, samplesPerSide) {
    const b = cell?.bounds
    if (!Array.isArray(b) || b.length < 2) return []
    const south = Number(b[0]?.[0])
    const west = Number(b[0]?.[1])
    const north = Number(b[1]?.[0])
    const east = Number(b[1]?.[1])
    if (!Number.isFinite(south) || !Number.isFinite(west) || !Number.isFinite(north) || !Number.isFinite(east)) {
        return []
    }
    const n = Math.max(1, Math.min(5, Number(samplesPerSide) || 1))
    const points = []
    for (let iy = 0; iy < n; iy++) {
        const tY = (iy + 0.5) / n
        const lat = south + (north - south) * tY
        for (let ix = 0; ix < n; ix++) {
            const tX = (ix + 0.5) / n
            const lng = west + (east - west) * tX
            points.push({lat, lng})
        }
    }
    return points
}

function boundsFromCells(cells) {
    let south = Infinity
    let west = Infinity
    let north = -Infinity
    let east = -Infinity
    for (const cell of cells || []) {
        const b = cell?.bounds
        if (!Array.isArray(b) || b.length < 2) continue
        const s = Number(b[0]?.[0])
        const w = Number(b[0]?.[1])
        const n = Number(b[1]?.[0])
        const e = Number(b[1]?.[1])
        if (Number.isFinite(s)) south = Math.min(south, s)
        if (Number.isFinite(w)) west = Math.min(west, w)
        if (Number.isFinite(n)) north = Math.max(north, n)
        if (Number.isFinite(e)) east = Math.max(east, e)
    }
    if (!Number.isFinite(south) || !Number.isFinite(west) || !Number.isFinite(north) || !Number.isFinite(east)) {
        return {south: 0, west: 0, north: 0, east: 0}
    }
    return {south, west, north, east}
}

function dominantClass(counts) {
    let best = null
    let max = -1
    for (const [key, value] of Object.entries(counts || {})) {
        const n = Number(value)
        if (!Number.isFinite(n)) continue
        if (n > max) {
            max = n
            best = Number(key)
        }
    }
    return Number.isFinite(best) ? best : null
}

function vegetationCellKey(ix, iy) {
    return `v${VEGETATION_CACHE_VERSION}:${VEGETATION_CELL_SIZE_M}:${ix}:${iy}`
}

function deriveVegetationSource(cells) {
    const sources = new Set()
    for (const cell of cells || []) {
        if (cell?.source) sources.add(String(cell.source))
    }
    if (sources.size === 1) return Array.from(sources)[0]
    if (sources.size > 1) return "mixed"
    return "unknown"
}

function mercatorFromLatLng(lat, lng) {
    const R = 6378137
    const clampedLat = Math.max(-85, Math.min(85, Number(lat)))
    const phi = (clampedLat * Math.PI) / 180
    const lambda = (Number(lng) * Math.PI) / 180
    return {
        x: R * lambda,
        y: R * Math.log(Math.tan(Math.PI / 4 + phi / 2))
    }
}

function latFromMercatorY(y) {
    const R = 6378137
    return (2 * Math.atan(Math.exp(Number(y) / R)) - Math.PI / 2) * (180 / Math.PI)
}

function lngFromMercatorX(x) {
    const R = 6378137
    return (Number(x) / R) * (180 / Math.PI)
}

function pointInPolygon(x, y, ring) {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1]
        const xj = ring[j][0], yj = ring[j][1]
        const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi
        if (intersect) inside = !inside
    }
    return inside
}
