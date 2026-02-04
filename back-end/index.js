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
