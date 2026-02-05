export function areaCacheKey(lat, lng, sideKm) {
    const latNum = Number(lat)
    const lngNum = Number(lng)
    const sideNum = Number(sideKm)
    const latKey = Number.isFinite(latNum) ? latNum.toFixed(6) : "nan"
    const lngKey = Number.isFinite(lngNum) ? lngNum.toFixed(6) : "nan"
    const sideKey = Number.isFinite(sideNum) ? sideNum.toFixed(3) : "nan"
    return `${latKey}:${lngKey}:${sideKey}`
}
