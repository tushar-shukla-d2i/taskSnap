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

        const filename = `screenshot-${Date.now()}.png`;

        const filepath = path.join(SCREENSHOT_DIR, filename);

        await page.screenshot({
            path: filepath,
            fullPage: true,
        });

        await browser.close();

        res.json({
            success: true,
            screenshot: `http://localhost:5000/screenshots/${filename}`,
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
});

app.listen(5000, () => {
    console.log("Server running on port 5000");
});