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

app.post("/capture", async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                message: "URL is required",
            });
        }

        if (!globalBrowser || !globalBrowser.isConnected()) {
            globalBrowser = await chromium.launch({
                headless: true,
                args: [
                    "--disable-dev-shm-usage", // Fixes issues and slowdowns in Docker/Linux environments
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-gpu", // GPU hardware acceleration isn't typically available on deployed servers
                ],
            });
        }

        const context = await globalBrowser.newContext({
            viewport: {
                width: 1440,
                height: 900,
            },
            bypassCSP: true, // Bypass CSP to ensure we can inject Twemoji and capture restricted sites
        });

        // Block heavy media files to speed up loading
        await context.route("**/*", (route) => {
            const request = route.request();
            if (["media", "websocket"].includes(request.resourceType())) {
                route.abort();
            } else {
                route.continue();
            }
        });

        const page = await context.newPage();

        await page.goto(url, {
            waitUntil: "domcontentloaded", // Faster than 'load', we'll load images during the manual scroll
            timeout: 30000, // Reduced from 60s so it fails faster if the site is completely unresponsive
        });

        // Scroll down the page to trigger lazy loading for images
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 1200; // Massively increased distance for faster scrolling
                let scrolls = 0; // Prevent infinite scroll on some pages
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    scrolls++;

                    if (totalHeight >= scrollHeight - window.innerHeight || scrolls >= 35) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 40); // 40ms interval is blazing fast but enough for intersection observers
            });
        });

        // Wait for lazy loaded images to finish downloading
        try {
            await page.waitForLoadState("networkidle", { timeout: 1500 }); // Reduced timeout
        } catch (e) {
            // Proceed even if network doesn't completely idle
        }

        // Fix missing emoji fonts on linux/dev servers by injecting Google's Noto Color Emoji
        try {
            await page.addStyleTag({ url: "https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap" });
            
            await page.evaluate(async () => {
                // Wait for the font to be loaded
                await document.fonts.ready;
                
                // Append the emoji font as a fallback to every element to preserve original fonts
                const elements = document.querySelectorAll('body, body *');
                for (const el of elements) {
                    const computed = window.getComputedStyle(el).fontFamily;
                    if (!computed.includes('Noto Color Emoji')) {
                        el.style.setProperty('font-family', `${computed}, "Noto Color Emoji"`, 'important');
                    }
                }
            });
            
            // Wait briefly for the text nodes to re-render with the new font
            await page.waitForTimeout(200);
        } catch (e) {
            console.error("Noto Color Emoji injection failed:", e);
        }

        const filename = `screenshot-${Date.now()}.png`;

        const filepath = path.join(SCREENSHOT_DIR, filename);

        await page.screenshot({
            path: filepath,
            fullPage: true,
        });

        await context.close(); // Close only the context, keep the browser running

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
    }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
    globalBrowser = await chromium.launch({
        headless: true,
        args: [
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-gpu",
        ],
    });
    console.log(`Server running on port ${PORT}`);
});