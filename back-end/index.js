const express = require("express");
const {createClient} = require("redis");

const app = express();
const PORT = 3000;
const REDIS_URLS = ["redis://127.0.0.1:6379", "redis://redis:6379"];
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

app.use(express.json({limit: "2mb"}));
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
    return `lte:building-height:${id}`;
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
            MATCH: "lte:building-height:*",
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
            MATCH: "lte:building-height:*",
            COUNT: 1000
        });
        cursor = String(result?.cursor ?? "0");
        const keys = Array.isArray(result?.keys) ? result.keys : [];
        count += keys.length;
    } while (cursor !== "0");
    res.json({count});
});

app.get("/cache/building-heights/stats", async (req, res) => {
    let cursor = "0";
    let count = 0;
    let bytes = 0;
    let usedExact = true;
    do {
        const result = await redis.scan(cursor, {
            MATCH: "lte:building-height:*",
            COUNT: 1000
        });
        cursor = String(result?.cursor ?? "0");
        const keys = Array.isArray(result?.keys) ? result.keys : [];
        if (keys.length) {
            count += keys.length;
            let sizes = null;
            if (usedExact) {
                try {
                    const pipeline = redis.multi();
                    for (const key of keys) pipeline.sendCommand(["MEMORY", "USAGE", key]);
                    sizes = await pipeline.exec();
                } catch {
                    usedExact = false;
                    sizes = null;
                }
                if (sizes) {
                    let ok = true;
                    for (const size of sizes) {
                        const n = Number(size);
                        if (!Number.isFinite(n)) {
                            ok = false;
                            break;
                        }
                        bytes += n;
                    }
                    if (!ok) {
                        usedExact = false;
                        sizes = null;
                    }
                }
            }
            if (!sizes) {
                const pipeline = redis.multi();
                for (const key of keys) pipeline.strLen(key);
                const estSizes = await pipeline.exec();
                for (let i = 0; i < keys.length; i++) {
                    const size = estSizes[i];
                    const n = Number(size);
                    if (Number.isFinite(n)) bytes += n;
                    bytes += Buffer.byteLength(keys[i], "utf8");
                }
            }
        }
    } while (cursor !== "0");
    res.json({count, bytes, mb: bytes / (1024 * 1024), exact: usedExact});
});

app.post("/cache/building-heights/reset", async (req, res) => {
    let cursor = "0";
    let deleted = 0;
    do {
        const result = await redis.scan(cursor, {
            MATCH: "lte:building-height:*",
            COUNT: 500
        });
        cursor = String(result?.cursor ?? "0");
        const keys = Array.isArray(result?.keys) ? result.keys : [];
        if (keys.length) {
            deleted += await redis.del(keys);
        }
    } while (cursor !== "0");
    res.json({deleted});
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
