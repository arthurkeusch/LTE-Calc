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
