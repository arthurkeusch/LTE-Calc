export function computeSquareBounds(lat, lng, sideKm) {
    const latNum = Number(lat)
    const lngNum = Number(lng)
    const sideNum = Number(sideKm)
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) || !Number.isFinite(sideNum) || sideNum <= 0) {
        return {south: latNum, north: latNum, west: lngNum, east: lngNum}
    }
    const halfSideM = (sideNum * 1000) / 2
    const latRad = (latNum * Math.PI) / 180
    const dLat = (halfSideM / 6378137) * (180 / Math.PI)
    const dLng = dLat / Math.cos(latRad)
    return {
        south: latNum - dLat,
        north: latNum + dLat,
        west: lngNum - dLng,
        east: lngNum + dLng
    }
}

export function delay(ms, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms)
        if (signal) {
            signal.addEventListener(
                "abort",
                () => {
                    clearTimeout(t)
                    reject(new DOMException("Aborted", "AbortError"))
                },
                {once: true}
            )
        }
    })
}

export async function runWithConcurrencyLimit(items, limit, worker) {
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

export function mercatorFromLatLng(lat, lng) {
    const latNum = Number(lat)
    const lngNum = Number(lng)
    const clampedLat = Math.max(-85, Math.min(85, latNum))
    const phi = (clampedLat * Math.PI) / 180
    const lambda = (lngNum * Math.PI) / 180
    const r = 6378137
    return {
        x: r * lambda,
        y: r * Math.log(Math.tan(Math.PI / 4 + phi / 2))
    }
}

export function latFromMercatorY(y) {
    const r = 6378137
    return (2 * Math.atan(Math.exp(Number(y) / r)) - Math.PI / 2) * (180 / Math.PI)
}

export function lngFromMercatorX(x) {
    const r = 6378137
    return (Number(x) / r) * (180 / Math.PI)
}

export function mercatorCellIndex(lat, lng, sizeM) {
    const size = Number(sizeM)
    if (!Number.isFinite(size) || size <= 0) return null
    const m = mercatorFromLatLng(lat, lng)
    if (!Number.isFinite(m?.x) || !Number.isFinite(m?.y)) return null
    return {ix: Math.floor(m.x / size), iy: Math.floor(m.y / size)}
}

export function buildMercatorCells(bounds, sizeM, keyFn) {
    const size = Number(sizeM)
    if (!bounds || !Number.isFinite(size) || size <= 0) return []
    const sw = mercatorFromLatLng(bounds.south, bounds.west)
    const ne = mercatorFromLatLng(bounds.north, bounds.east)
    const xMin = Math.min(sw.x, ne.x)
    const xMax = Math.max(sw.x, ne.x)
    const yMin = Math.min(sw.y, ne.y)
    const yMax = Math.max(sw.y, ne.y)
    const ixMin = Math.floor(xMin / size)
    const ixMax = Math.floor((xMax - 1e-6) / size)
    const iyMin = Math.floor(yMin / size)
    const iyMax = Math.floor((yMax - 1e-6) / size)
    const cells = []
    for (let iy = iyMin; iy <= iyMax; iy++) {
        const y0 = iy * size
        const y1 = y0 + size
        const south = latFromMercatorY(y0)
        const north = latFromMercatorY(y1)
        const lat = (south + north) / 2
        for (let ix = ixMin; ix <= ixMax; ix++) {
            const x0 = ix * size
            const x1 = x0 + size
            const west = lngFromMercatorX(x0)
            const east = lngFromMercatorX(x1)
            const lng = (west + east) / 2
            const key = typeof keyFn === "function" ? keyFn(ix, iy) : `${ix}:${iy}`
            cells.push({
                key,
                ix,
                iy,
                bounds: [[south, west], [north, east]],
                center: {lat, lng}
            })
        }
    }
    return cells
}

export function boundsFromCells(cells) {
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
        return null
    }
    return {south, west, north, east}
}

export function intersectBounds(a, b) {
    if (!a || !b) return null
    const south = Math.max(Number(a.south), Number(b.south))
    const west = Math.max(Number(a.west), Number(b.west))
    const north = Math.min(Number(a.north), Number(b.north))
    const east = Math.min(Number(a.east), Number(b.east))
    if (!Number.isFinite(south) || !Number.isFinite(west) || !Number.isFinite(north) || !Number.isFinite(east)) {
        return null
    }
    if (south >= north || west >= east) return null
    return {south, west, north, east}
}

export function clipPolylineToBounds(points, bounds) {
    const pts = Array.isArray(points) ? points : []
    if (!bounds || pts.length < 2) return []
    const segments = []
    let current = []
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        if (!isPoint(a) || !isPoint(b)) continue
        const clipped = clipSegmentToBounds(a, b, bounds)
        if (clipped) {
            const [c0, c1] = clipped
            if (current.length === 0) {
                current.push(c0)
            } else if (!pointsEqual(current[current.length - 1], c0)) {
                current.push(c0)
            }
            current.push(c1)
        } else if (current.length > 1) {
            segments.push(dedupeLine(current))
            current = []
        } else {
            current = []
        }
    }
    if (current.length > 1) segments.push(dedupeLine(current))
    if (!segments.length) return []
    if (segments.length === 1) return segments[0]
    let best = segments[0]
    let bestLen = polylineLength(best)
    for (let i = 1; i < segments.length; i++) {
        const len = polylineLength(segments[i])
        if (len > bestLen) {
            bestLen = len
            best = segments[i]
        }
    }
    return best
}

export function clipPolygonToBounds(points, bounds) {
    const pts = Array.isArray(points) ? points : []
    if (!bounds || pts.length < 3) return []
    let output = pts.slice()
    output = clipPolygonAgainstEdge(output, p => p[1] >= bounds.west, (a, b) => intersectVertical(a, b, bounds.west))
    output = clipPolygonAgainstEdge(output, p => p[1] <= bounds.east, (a, b) => intersectVertical(a, b, bounds.east))
    output = clipPolygonAgainstEdge(output, p => p[0] >= bounds.south, (a, b) => intersectHorizontal(a, b, bounds.south))
    output = clipPolygonAgainstEdge(output, p => p[0] <= bounds.north, (a, b) => intersectHorizontal(a, b, bounds.north))
    output = dedupeRing(output)
    return output.length >= 3 ? output : []
}

function clipSegmentToBounds(a, b, bounds) {
    const x0 = Number(a[1])
    const y0 = Number(a[0])
    const x1 = Number(b[1])
    const y1 = Number(b[0])
    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return null
    const dx = x1 - x0
    const dy = y1 - y0
    let u1 = 0
    let u2 = 1
    const checks = [
        [-dx, x0 - bounds.west],
        [dx, bounds.east - x0],
        [-dy, y0 - bounds.south],
        [dy, bounds.north - y0]
    ]
    for (const [p, q] of checks) {
        if (p === 0) {
            if (q < 0) return null
            continue
        }
        const t = q / p
        if (p < 0) {
            if (t > u2) return null
            if (t > u1) u1 = t
        } else {
            if (t < u1) return null
            if (t < u2) u2 = t
        }
    }
    if (u2 < u1) return null
    const nx0 = x0 + u1 * dx
    const ny0 = y0 + u1 * dy
    const nx1 = x0 + u2 * dx
    const ny1 = y0 + u2 * dy
    return [[ny0, nx0], [ny1, nx1]]
}

function clipPolygonAgainstEdge(points, isInside, intersect) {
    const pts = Array.isArray(points) ? points : []
    if (!pts.length) return []
    const output = []
    let prev = pts[pts.length - 1]
    for (const curr of pts) {
        const prevInside = isInside(prev)
        const currInside = isInside(curr)
        if (prevInside && currInside) {
            output.push(curr)
        } else if (prevInside && !currInside) {
            const i = intersect(prev, curr)
            if (i) output.push(i)
        } else if (!prevInside && currInside) {
            const i = intersect(prev, curr)
            if (i) output.push(i)
            output.push(curr)
        }
        prev = curr
    }
    return output
}

function intersectVertical(a, b, x) {
    const x0 = Number(a[1])
    const y0 = Number(a[0])
    const x1 = Number(b[1])
    const y1 = Number(b[0])
    const dx = x1 - x0
    if (dx === 0) return [y0, x]
    const t = (x - x0) / dx
    const y = y0 + t * (y1 - y0)
    return [y, x]
}

function intersectHorizontal(a, b, y) {
    const x0 = Number(a[1])
    const y0 = Number(a[0])
    const x1 = Number(b[1])
    const y1 = Number(b[0])
    const dy = y1 - y0
    if (dy === 0) return [y, x0]
    const t = (y - y0) / dy
    const x = x0 + t * (x1 - x0)
    return [y, x]
}

function isPoint(p) {
    return Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))
}

function pointsEqual(a, b, eps = 1e-9) {
    return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps
}

function dedupeLine(points) {
    const out = []
    for (const p of points || []) {
        if (!out.length || !pointsEqual(out[out.length - 1], p)) out.push(p)
    }
    return out
}

function dedupeRing(points) {
    const out = dedupeLine(points)
    if (out.length > 2 && pointsEqual(out[0], out[out.length - 1])) out.pop()
    return out
}

function polylineLength(points) {
    let sum = 0
    for (let i = 0; i < points.length - 1; i++) {
        sum += distanceLatLng(points[i], points[i + 1])
    }
    return sum
}

function distanceLatLng(a, b) {
    const toRad = Math.PI / 180
    const lat1 = Number(a[0]) * toRad
    const lat2 = Number(b[0]) * toRad
    const dLat = lat2 - lat1
    const dLng = (Number(b[1]) - Number(a[1])) * toRad
    const x = dLng * Math.cos((lat1 + lat2) / 2)
    const y = dLat
    return Math.sqrt(x * x + y * y) * 6378137
}
