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

app.post("/capture", async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                message: "URL is required",
            });
        }

        const browser = await chromium.launch({
            headless: true,
        });

        const page = await browser.newPage({
            viewport: {
                width: 1440,
                height: 900,
            },
        });

        await page.goto(url, {
            waitUntil: "networkidle",
            timeout: 60000,
        });

        // Scroll down the page to trigger lazy loading for images
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                let scrolls = 0; // Prevent infinite scroll on some pages
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    scrolls++;

                    if (totalHeight >= scrollHeight - window.innerHeight || scrolls >= 200) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 50);
            });
        });

        // Wait for lazy loaded images to finish downloading
        try {
            await page.waitForLoadState("networkidle", { timeout: 3000 });
        } catch (e) {
            // Proceed even if network doesn't completely idle
        }

        const filename = `screenshot-${Date.now()}.png`;

        const filepath = path.join(SCREENSHOT_DIR, filename);

        await page.screenshot({
            path: filepath,
            fullPage: true,
        });

        await browser.close();

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

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});