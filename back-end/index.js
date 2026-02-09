const express = require("express");
const {createClient} = require("redis");

const app = express();
const PORT = 3000;
const REDIS_URLS = ["redis://127.0.0.1:6379", "redis://redis:6379"];
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const CACHE_PREFIX_HEIGHTS = "lte:building-height:";
const CACHE_PREFIX_ROADS = "lte:roads:";
const CACHE_PREFIX_BUILDINGS = "lte:buildings:";
const CACHE_PREFIX_DENSITY = "lte:density:";
const CACHE_PREFIX_VEGETATION = "lte:vegetation-cell:";
const CACHE_PREFIX_RELIEF = "lte:relief-cell:";

app.use(express.json({limit: "10mb"}));
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

let redis = null;

async function connectRedis() {
    let lastError = null;
    for (const url of REDIS_URLS) {
        console.log(`Tentative de connexion Redis: ${url}`);
        const client = createClient({
            url,
            socket: {
                connectTimeout: 1500,
                reconnectStrategy: (retries) => {
                    if (retries >= 2) return new Error("Redis retry limit reached");
                    return 200;
                }
            }
        });
        client.on("error", (err) => {
            console.error("Redis error:", err);
        });
        try {
            await client.connect();
            redis = client;
            console.log(`Redis connecté sur ${url}`);
            return;
        } catch (err) {
            lastError = err;
            try {
                await client.disconnect();
            } catch {
                // ignore
            }
        }
    }
    throw lastError || new Error("Redis connection failed");
}

function heightKey(id) {
    return `${CACHE_PREFIX_HEIGHTS}${id}`;
}

function cacheKey(prefix, key) {
    return `${prefix}${key}`;
}

function normalizeCacheKey(value) {
    if (value === undefined || value === null) return "";
    return String(value);
}

async function supportsMemoryUsage() {
    try {
        await redis.sendCommand(["MEMORY", "USAGE", `${CACHE_PREFIX_HEIGHTS}__probe__`]);
        return true;
    } catch {
        return false;
    }
}

async function scanCacheStats(prefix, useExact) {
    let cursor = "0";
    let count = 0;
    let bytes = 0;
    let exact = useExact;
    do {
        const result = await redis.scan(cursor, {
            MATCH: `${prefix}*`,
            COUNT: 1000
        });
        cursor = String(result?.cursor ?? "0");
        const keys = Array.isArray(result?.keys) ? result.keys : [];
        if (!keys.length) continue;
        count += keys.length;
        if (exact) {
            try {
                for (const key of keys) {
                    const size = await redis.sendCommand(["MEMORY", "USAGE", key]);
                    const n = Number(size);
                    if (Number.isFinite(n)) bytes += n;
                }
                continue;
            } catch {
                exact = false;
            }
        }
        const pipeline = redis.multi();
        for (const key of keys) pipeline.strLen(key);
        const sizes = await pipeline.exec();
        for (let i = 0; i < keys.length; i++) {
            const size = sizes[i];
            const n = Number(size);
            if (Number.isFinite(n)) bytes += n;
            bytes += Buffer.byteLength(keys[i], "utf8");
        }
    } while (cursor !== "0");
    return {count, bytes, mb: bytes / (1024 * 1024), exact};
}

async function deleteByPrefix(prefix) {
    let cursor = "0";
    let deleted = 0;
    do {
        const result = await redis.scan(cursor, {
            MATCH: `${prefix}*`,
            COUNT: 1000
        });
        cursor = String(result?.cursor ?? "0");
        const keys = Array.isArray(result?.keys) ? result.keys : [];
        if (keys.length) {
            deleted += await redis.del(keys);
        }
    } while (cursor !== "0");
    return deleted;
}

app.get("/", (req, res) => {
    res.json({status: "ok"});
});

app.post("/cache/building-heights", async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.json({heights: {}});

    const keys = ids.map((id) => heightKey(id));
    const values = await redis.mGet(keys);
    const heights = {};
    for (let i = 0; i < ids.length; i++) {
        const v = values[i];
        if (v === null || v === undefined) continue;
        const n = Number(v);
        if (Number.isFinite(n)) heights[ids[i]] = n;
    }
    res.json({heights});
});

app.post("/cache/building-heights/store", async (req, res) => {
    const heights = req.body?.heights;
    if (!heights || typeof heights !== "object") {
        return res.status(400).json({error: "Invalid heights payload"});
    }
    const entries = Object.entries(heights);
    if (!entries.length) return res.json({stored: 0});

    const pipeline = redis.multi();
    let stored = 0;
    for (const [id, h] of entries) {
        const n = Number(h);
        if (!Number.isFinite(n)) continue;
        pipeline.set(heightKey(id), String(n), {EX: CACHE_TTL_SECONDS});
        stored++;
    }
    if (stored) await pipeline.exec();
    res.json({stored});
});

app.post("/cache/roads", async (req, res) => {
    const key = normalizeCacheKey(req.body?.key);
    if (!key) return res.json({hit: false});
    const value = await redis.get(cacheKey(CACHE_PREFIX_ROADS, key));
    if (!value) return res.json({hit: false});
    try {
        const data = JSON.parse(value);
        return res.json({hit: true, data});
    } catch {
        return res.json({hit: false});
    }
});

app.post("/cache/roads/store", async (req, res) => {
    const key = normalizeCacheKey(req.body?.key);
    const data = req.body?.data;
    if (!key || !data || typeof data !== "object") {
        return res.status(400).json({error: "Invalid roads payload"});
    }
    await redis.set(cacheKey(CACHE_PREFIX_ROADS, key), JSON.stringify(data), {EX: CACHE_TTL_SECONDS});
    res.json({stored: true});
});

app.post("/cache/buildings", async (req, res) => {
    const key = normalizeCacheKey(req.body?.key);
    if (!key) return res.json({hit: false});
    const value = await redis.get(cacheKey(CACHE_PREFIX_BUILDINGS, key));
    if (!value) return res.json({hit: false});
    try {
        const data = JSON.parse(value);
        return res.json({hit: true, data});
    } catch {
        return res.json({hit: false});
    }
});

app.post("/cache/buildings/store", async (req, res) => {
    const key = normalizeCacheKey(req.body?.key);
    const data = req.body?.data;
    if (!key || !data || typeof data !== "object") {
        return res.status(400).json({error: "Invalid buildings payload"});
    }
    await redis.set(cacheKey(CACHE_PREFIX_BUILDINGS, key), JSON.stringify(data), {EX: CACHE_TTL_SECONDS});
    res.json({stored: true});
});

app.post("/cache/density", async (req, res) => {
    const key = normalizeCacheKey(req.body?.key);
    if (!key) return res.json({hit: false});
    const value = await redis.get(cacheKey(CACHE_PREFIX_DENSITY, key));
    if (!value) return res.json({hit: false});
    try {
        const data = JSON.parse(value);
        return res.json({hit: true, data});
    } catch {
        return res.json({hit: false});
    }
});

app.post("/cache/density/store", async (req, res) => {
    const key = normalizeCacheKey(req.body?.key);
    const data = req.body?.data;
    if (!key || !data || typeof data !== "object") {
        return res.status(400).json({error: "Invalid density payload"});
    }
    await redis.set(cacheKey(CACHE_PREFIX_DENSITY, key), JSON.stringify(data), {EX: CACHE_TTL_SECONDS});
    res.json({stored: true});
});

app.post("/cache/vegetation", async (req, res) => {
    const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
    const single = normalizeCacheKey(req.body?.key);
    const list = keys.length ? keys : (single ? [single] : []);
    if (!list.length) return res.json({cells: {}});

    const redisKeys = list.map((k) => cacheKey(CACHE_PREFIX_VEGETATION, normalizeCacheKey(k)));
    const values = await redis.mGet(redisKeys);
    const cells = {};
    for (let i = 0; i < list.length; i++) {
        const raw = values[i];
        if (!raw) continue;
        try {
            const data = JSON.parse(raw);
            if (data && typeof data === "object") {
                cells[list[i]] = data;
            }
        } catch {
            // ignore invalid cache entries
        }
    }
    res.json({cells});
});

app.post("/cache/vegetation/store", async (req, res) => {
    const payload = req.body?.cells;
    const singleKey = normalizeCacheKey(req.body?.key);
    const singleData = req.body?.data;
    const cells = payload && typeof payload === "object"
        ? payload
        : (singleKey && singleData && typeof singleData === "object" ? {[singleKey]: singleData} : null);

    if (!cells || typeof cells !== "object") {
        return res.status(400).json({error: "Invalid vegetation payload"});
    }
    const entries = Object.entries(cells);
    if (!entries.length) return res.json({stored: 0});

    const pipeline = redis.multi();
    let stored = 0;
    for (const [key, data] of entries) {
        const k = normalizeCacheKey(key);
        if (!k || !data || typeof data !== "object") continue;
        pipeline.set(cacheKey(CACHE_PREFIX_VEGETATION, k), JSON.stringify(data), {EX: CACHE_TTL_SECONDS});
        stored++;
    }
    if (stored) await pipeline.exec();
    res.json({stored});
});

app.post("/cache/relief", async (req, res) => {
    const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
    const single = normalizeCacheKey(req.body?.key);
    const list = keys.length ? keys : (single ? [single] : []);
    if (!list.length) return res.json({cells: {}});

    const redisKeys = list.map((k) => cacheKey(CACHE_PREFIX_RELIEF, normalizeCacheKey(k)));
    const values = await redis.mGet(redisKeys);
    const cells = {};
    for (let i = 0; i < list.length; i++) {
        const raw = values[i];
        if (!raw) continue;
        try {
            const data = JSON.parse(raw);
            if (data && typeof data === "object") {
                cells[list[i]] = data;
            }
        } catch {
            // ignore invalid cache entries
        }
    }
    res.json({cells});
});

app.post("/cache/relief/store", async (req, res) => {
    const payload = req.body?.cells;
    const singleKey = normalizeCacheKey(req.body?.key);
    const singleData = req.body?.data;
    const cells = payload && typeof payload === "object"
        ? payload
        : (singleKey && singleData && typeof singleData === "object" ? {[singleKey]: singleData} : null);

    if (!cells || typeof cells !== "object") {
        return res.status(400).json({error: "Invalid relief payload"});
    }
    const entries = Object.entries(cells);
    if (!entries.length) return res.json({stored: 0});

    const pipeline = redis.multi();
    let stored = 0;
    for (const [key, data] of entries) {
        const k = normalizeCacheKey(key);
        if (!k || !data || typeof data !== "object") continue;
        pipeline.set(cacheKey(CACHE_PREFIX_RELIEF, k), JSON.stringify(data), {EX: CACHE_TTL_SECONDS});
        stored++;
    }
    if (stored) await pipeline.exec();
    res.json({stored});
});

app.get("/cache/building-heights/stats/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders && res.flushHeaders();

    let closed = false;
    req.on("close", () => {
        closed = true;
    });

    let cursor = "0";
    let count = 0;
    let bytes = 0;
    res.write(`data: ${JSON.stringify({count, bytes, mb: 0, done: false})}\n\n`);
    res.flush && res.flush();
    do {
        const result = await redis.scan(cursor, {
            MATCH: `${CACHE_PREFIX_HEIGHTS}*`,
            COUNT: 500
        });
        cursor = String(result?.cursor ?? "0");
        const keys = Array.isArray(result?.keys) ? result.keys : [];
        if (keys.length) {
            count += keys.length;
            const pipeline = redis.multi();
            for (const key of keys) pipeline.strLen(key);
            const sizes = await pipeline.exec();
            for (let i = 0; i < keys.length; i++) {
                const size = sizes[i];
                const n = Number(size);
                if (Number.isFinite(n)) bytes += n;
                bytes += Buffer.byteLength(keys[i], "utf8");
            }
        }
        res.write(`data: ${JSON.stringify({count, bytes, mb: bytes / (1024 * 1024), done: false})}\n\n`);
        res.flush && res.flush();
        await new Promise(resolve => setImmediate(resolve));
    } while (!closed && cursor !== "0");
    if (!closed) {
        res.write(`data: ${JSON.stringify({count, bytes, mb: bytes / (1024 * 1024), done: true})}\n\n`);
        res.end();
    }
});

app.get("/cache/building-heights/count", async (req, res) => {
    let cursor = "0";
    let count = 0;
    do {
        const result = await redis.scan(cursor, {
            MATCH: `${CACHE_PREFIX_HEIGHTS}*`,
            COUNT: 1000
        });
        cursor = String(result?.cursor ?? "0");
        const keys = Array.isArray(result?.keys) ? result.keys : [];
        count += keys.length;
    } while (cursor !== "0");
    res.json({count});
});

app.get("/cache/building-heights/stats", async (req, res) => {
    const useExact = await supportsMemoryUsage();
    const stats = await scanCacheStats(CACHE_PREFIX_HEIGHTS, useExact);
    res.json({count: stats.count, bytes: stats.bytes, mb: stats.mb, exact: stats.exact});
});

app.get("/cache/stats", async (req, res) => {
    const useExact = await supportsMemoryUsage();
    const heights = await scanCacheStats(CACHE_PREFIX_HEIGHTS, useExact);
    const roads = await scanCacheStats(CACHE_PREFIX_ROADS, heights.exact);
    const buildings = await scanCacheStats(CACHE_PREFIX_BUILDINGS, heights.exact);
    const density = await scanCacheStats(CACHE_PREFIX_DENSITY, heights.exact);
    const vegetation = await scanCacheStats(CACHE_PREFIX_VEGETATION, heights.exact);
    const relief = await scanCacheStats(CACHE_PREFIX_RELIEF, heights.exact);
    const totalBytes = heights.bytes + roads.bytes + buildings.bytes + density.bytes + vegetation.bytes + relief.bytes;
    const totalCount = heights.count + roads.count + buildings.count + density.count + vegetation.count + relief.count;
    res.json({
        exact: heights.exact && roads.exact && buildings.exact && density.exact && vegetation.exact && relief.exact,
        total: {count: totalCount, bytes: totalBytes, mb: totalBytes / (1024 * 1024)},
        heights,
        roads,
        buildings,
        density,
        vegetation,
        relief
    });
});

app.post("/cache/building-heights/reset", async (req, res) => {
    const deleted = {
        heights: await deleteByPrefix(CACHE_PREFIX_HEIGHTS),
        roads: await deleteByPrefix(CACHE_PREFIX_ROADS),
        buildings: await deleteByPrefix(CACHE_PREFIX_BUILDINGS),
        density: await deleteByPrefix(CACHE_PREFIX_DENSITY),
        vegetation: await deleteByPrefix(CACHE_PREFIX_VEGETATION),
        relief: await deleteByPrefix(CACHE_PREFIX_RELIEF)
    };
    const total = deleted.heights + deleted.roads + deleted.buildings + deleted.density + deleted.vegetation + deleted.relief;
    res.json({deleted, total});
});

async function start() {
    await connectRedis();
    app.listen(PORT, () => {
        console.log(`Serveur demarre sur http://localhost:${PORT}`);
    });
}

start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
});
