const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(express.json());

const SCREENSHOT_DIR = path.join(__dirname, "screenshots");

if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR);
}

app.use("/screenshots", express.static(SCREENSHOT_DIR));

// Global browser instance to avoid launching chromium on every request
let globalBrowser;
let browserLaunching; // promise guard so concurrent requests don't double-launch

async function getBrowser() {
    if (globalBrowser && globalBrowser.isConnected()) return globalBrowser;
    if (browserLaunching) return browserLaunching;

    browserLaunching = chromium.launch({
        headless: true,
        args: [
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-default-apps",
            "--mute-audio",
        ],
    });

    globalBrowser = await browserLaunching;
    browserLaunching = null;
    return globalBrowser;
}

// One-time global stylesheet text — avoids the expensive per-element querySelectorAll+loop
const EMOJI_FALLBACK_CSS = `
* { font-family: inherit, "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif !important; }
`;

app.post("/capture", async (req, res) => {
    let context;
    try {
        const { url, format = "jpeg", quality = 80, fast = false } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                message: "URL is required",
            });
        }

        const browser = await getBrowser();

        context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            bypassCSP: true,
        });

        // Block heavy/unnecessary resources. In "fast" mode also block images for max speed.
        const blockedTypes = fast
            ? ["media", "websocket", "image", "font"]
            : ["media", "websocket"];

        await context.route("**/*", (route) => {
            const request = route.request();
            if (blockedTypes.includes(request.resourceType())) {
                route.abort();
            } else {
                route.continue();
            }
        });

        const page = await context.newPage();

        // 1. Wait until 'load' so the initial DOM, CSS, and JS are fully parsed and mounted
        await page.goto(url, {
            waitUntil: "load",
            timeout: 25000,
        });

        // 2. Defeat native lazy loading by removing the loading attribute
        await page.evaluate(() => {
            document.querySelectorAll('img[loading="lazy"]').forEach(img => {
                img.removeAttribute('loading');
            });
        });

        // 3. Deliberate, smooth scroll to trigger JS-based lazy loaders (like AOS, lazysizes)
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = window.innerHeight / 2; // Scroll half a viewport to catch everything
                let scrolls = 0;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    scrolls++;

                    // Stop if we reach the bottom or after a reasonable limit
                    if (totalHeight >= scrollHeight - window.innerHeight || scrolls >= 60) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 150); // 150ms gives IntersectionObservers plenty of time to fire
            });
        });

        // 4. Reset scroll position to top to fix fixed/sticky headers
        // We add a 1000ms delay here because some headers have CSS "slide down" animations 
        // when returning to the top, and we need to wait for them to finish before snapping.
        await page.evaluate(async () => {
            window.scrollTo(0, 0);
            await new Promise(resolve => setTimeout(resolve, 1000));
        });

        // 5. Wait explicitly for all currently parsed <img> tags to finish downloading
        await page.evaluate(async () => {
            const images = Array.from(document.querySelectorAll('img'));
            await Promise.all(images.map(img => {
                if (img.complete) return Promise.resolve();
                return new Promise(resolve => {
                    img.addEventListener('load', resolve);
                    img.addEventListener('error', resolve);
                });
            }));
        });

        // 6. Final safety wait for late network requests (e.g. background-images in CSS)
        try {
            await page.waitForLoadState("networkidle", { timeout: 5000 });
        } catch (e) {
            // fine, proceed anyway
        }

        // Lightweight emoji fallback: single stylesheet injection, no DOM walking, no remote font fetch
        if (!fast) {
            try {
                await page.addStyleTag({ content: EMOJI_FALLBACK_CSS });
            } catch (e) {
                console.error("Emoji fallback CSS injection failed:", e);
            }
        }

        const ext = format === "png" ? "png" : "jpeg";
        const filename = `screenshot-${Date.now()}.${ext}`;
        const filepath = path.join(SCREENSHOT_DIR, filename);

        const screenshotOptions = {
            path: filepath,
            fullPage: true,
            animations: "disabled",
            timeout: 60000,
            type: ext,
        };
        if (ext === "jpeg") {
            screenshotOptions.quality = quality; // jpeg encodes much faster than png
        }

        await page.screenshot(screenshotOptions);

        const protocol = req.headers["x-forwarded-proto"] || req.protocol;
        const host = req.get("host");
        const baseUrl = `${protocol}://${host}`;

        res.json({
            success: true,
            screenshot: `${baseUrl}/screenshots/${filename}`,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: error.message,
        });
    } finally {
        // Always close the context, even on error, so it doesn't leak across requests
        if (context) {
            await context.close().catch(() => { });
        }
    }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
    await getBrowser();
    console.log(`Server running on port ${PORT}`);
});

process.on("SIGTERM", async () => {
    if (globalBrowser) await globalBrowser.close().catch(() => { });
    process.exit(0);
});