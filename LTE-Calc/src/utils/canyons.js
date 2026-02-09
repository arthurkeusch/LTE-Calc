const DEFAULT_BUFFER_M = 30
const DEFAULT_LANE_WIDTH_M = 3.25
const FALLBACK_WIDTH_M = 6.5
const DEFAULT_LANES_BY_HIGHWAY = {
  motorway: 4,
  motorway_link: 2,
  trunk: 3,
  trunk_link: 2,
  primary: 2,
  primary_link: 2,
  secondary: 2,
  secondary_link: 2,
  tertiary: 2,
  tertiary_link: 1,
  residential: 2,
  living_street: 1,
  service: 1,
  unclassified: 2,
  road: 2
}

export function computeStreetCanyonStats(roads, buildings, center, options = {}) {
  if (!center || !Array.isArray(roads) || !Array.isArray(buildings)) {
    return {stats: null, roads: []}
  }
  const bufferM = Number.isFinite(options.bufferM) ? options.bufferM : DEFAULT_BUFFER_M
  const laneWidthM = Number.isFinite(options.laneWidthM) ? options.laneWidthM : DEFAULT_LANE_WIDTH_M

  const buildingPoints = []
  for (const b of buildings) {
    const height = Number(b?.height)
    if (!Number.isFinite(height) || height <= 0) continue
    const geometry = Array.isArray(b?.geometry) ? b.geometry : []
    if (geometry.length < 3) continue
    const centroid = polygonCentroidLatLng(geometry)
    if (!centroid) continue
    const xy = toLocalXY(centroid, center)
    buildingPoints.push({x: xy.x, y: xy.y, height})
  }

  if (!buildingPoints.length) return {stats: null, roads: []}

  const canyonValues = []
  const outRoads = []
  for (const road of roads) {
    const geometry = Array.isArray(road?.geometry) ? road.geometry : []
    if (geometry.length < 2) continue

    const line = geometry.map(p => toLocalXY({lat: p[0], lng: p[1]}, center))
    const heights = []
    let minLeft = null
    let minRight = null

    for (const b of buildingPoints) {
      const {dist, sign} = distancePointToPolylineSigned(b, line)
      if (!Number.isFinite(dist) || dist > bufferM) continue
      heights.push(b.height)
      if (sign > 0) {
        if (minLeft === null || dist < minLeft) minLeft = dist
      } else if (sign < 0) {
        if (minRight === null || dist < minRight) minRight = dist
      }
    }

    if (!heights.length) continue
    const meanHeight = heights.reduce((s, h) => s + h, 0) / heights.length
    if (!Number.isFinite(meanHeight) || meanHeight <= 0) continue

    let width = null
    if (Number.isFinite(minLeft) && Number.isFinite(minRight)) {
      const w = minLeft + minRight
      if (w > 0) width = w
    }
    if (!Number.isFinite(width) || width <= 0) {
      width = estimateRoadWidth(road, laneWidthM)
    }
    if (!Number.isFinite(width) || width <= 0) continue

    const index = meanHeight / width
    if (!Number.isFinite(index) || index <= 0) continue

    canyonValues.push(index)
    outRoads.push({
      ...road,
      canyonIndex: index,
      canyonHeight: meanHeight,
      canyonWidth: width
    })
  }

  const stats = computeIndexStats(canyonValues)
  stats.buckets = bucketizeCanyonValues(canyonValues)
  return {stats, roads: outRoads}
}

export function classifyStreetCanyonIndex(value) {
  if (!Number.isFinite(value)) return "unknown"
  if (value < 0.5) return "open"
  if (value < 1) return "urban"
  if (value < 2) return "canyon"
  return "dense"
}

function estimateRoadWidth(road, laneWidthM) {
  const width = normalizeNumber(road?.width)
  if (Number.isFinite(width) && width > 0) return width

  const lanes = normalizeNumber(road?.lanes)
  if (Number.isFinite(lanes) && lanes > 0) return lanes * laneWidthM

  const highway = (road?.highway || "").toString()
  const defaultLanes = DEFAULT_LANES_BY_HIGHWAY[highway]
  if (Number.isFinite(defaultLanes) && defaultLanes > 0) return defaultLanes * laneWidthM

  return FALLBACK_WIDTH_M
}

function normalizeNumber(value) {
  if (Number.isFinite(value)) return Number(value)
  if (typeof value === "string") {
    const m = value.match(/(\d+(\.\d+)?)/)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function computeIndexStats(values) {
  const v = (values || []).filter(n => Number.isFinite(n)).slice().sort((a, b) => a - b)
  const count = v.length
  if (count === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      avg: 0,
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
    hist10
  }
}

function bucketizeCanyonValues(values) {
  const buckets = [0, 0, 0, 0]
  for (const v of values || []) {
    if (!Number.isFinite(v)) continue
    if (v < 0.5) buckets[0] += 1
    else if (v < 1) buckets[1] += 1
    else if (v < 2) buckets[2] += 1
    else buckets[3] += 1
  }
  return buckets
}

function toLocalXY(point, origin) {
  const toRad = Math.PI / 180
  const R = 6378137
  const cosLat = Math.cos(origin.lat * toRad)
  const x = (point.lng - origin.lng) * toRad * R * cosLat
  const y = (point.lat - origin.lat) * toRad * R
  return {x, y}
}

function distancePointToPolylineSigned(point, line) {
  let bestDist = Infinity
  let bestSign = 0
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]
    const b = line[i + 1]
    const {dist, sign} = distancePointToSegmentSigned(point, a, b)
    if (dist < bestDist) {
      bestDist = dist
      bestSign = sign
    }
  }
  return {dist: bestDist, sign: bestSign}
}

function distancePointToSegmentSigned(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (!Number.isFinite(len2) || len2 === 0) {
    const dist = Math.hypot(p.x - a.x, p.y - a.y)
    return {dist, sign: 0}
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  const dist = Math.hypot(p.x - projX, p.y - projY)
  const cross = dx * (p.y - a.y) - dy * (p.x - a.x)
  const sign = Math.abs(cross) < 1e-9 ? 0 : Math.sign(cross)
  return {dist, sign}
}

function polygonCentroidLatLng(pts) {
  if (!Array.isArray(pts) || pts.length === 0) return null
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

function averageLatLng(pts) {
  let sumLat = 0
  let sumLng = 0
  for (const p of pts) {
    sumLat += p[0]
    sumLng += p[1]
  }
  return {lat: sumLat / pts.length, lng: sumLng / pts.length}
}
