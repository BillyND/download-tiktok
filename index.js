const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const https = require("https");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const MAX_STORAGE_TIME = 300000; // 5 minutes in milliseconds
const SERVICE_API_URL = process.env.SERVICE_API_URL;

// Middleware setup
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * Extract video URL from input text
 * @param {string} url - The input URL or text
 * @returns {string|null} - Extracted video URL or null
 */
function extractVideoUrl(url) {
  const urlMatch = url.match(/https[^\s]+/g);
  return urlMatch ? urlMatch[0] : null;
}

/**
 * Fetch token from service site
 * @returns {Promise<string>} - Authentication token
 */
async function fetchToken() {
  try {
    const response = await fetch(SERVICE_API_URL);
    const html = await response.text();
    const dom = new JSDOM(html);
    const token = dom.window.document
      .getElementById("token")
      ?.getAttribute("value");

    if (!token) {
      throw new Error("Token not found or empty");
    }

    return token;
  } catch (error) {
    console.error("Error fetching token:", error);
    throw error;
  }
}

/**
 * Download file from URL to local path
 * @param {string} url - Source URL
 * @param {string} destPath - Destination file path
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(destPath);

    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          fileStream.close();
          fs.unlink(destPath, () => {});
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(fileStream);

        fileStream.on("error", (err) => {
          fileStream.close();
          fs.unlink(destPath, () => {});
          reject(err);
        });

        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });
      })
      .on("error", (err) => {
        fileStream.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

/**
 * Clean up old files from uploads directory
 */
function cleanupOldFiles() {
  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      console.error("Error reading uploads directory:", err);
      return;
    }

    const now = Date.now();

    files.forEach((file) => {
      const filePath = path.join(uploadsDir, file);

      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`Error getting stats for file ${file}:`, err);
          return;
        }

        const fileAge = now - stats.mtimeMs;

        if (fileAge > MAX_STORAGE_TIME) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`Error deleting file ${file}:`, err);
            } else {
              console.log(`Deleted expired file: ${file}`);
            }
          });
        }
      });
    });
  });
}

// Download endpoint
app.post("/download", async (req, res) => {
  cleanupOldFiles();

  try {
    const url = req.body.url;
    const videoUrl = extractVideoUrl(url);

    if (!videoUrl) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    // Get authentication token
    const token = await fetchToken();

    // Fetch video data
    const response = await fetch(
      `${SERVICE_API_URL}/wp-json/aio-dl/video-data/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${token}`,
        },
        body: new URLSearchParams({ url: videoUrl }),
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();

    // Get download URL
    const downloadUrl = data?.medias?.[0]?.url;
    if (!downloadUrl) {
      return res
        .status(404)
        .json({ error: "No download URL found in response" });
    }

    // Generate unique filename
    const fileExtension = path.extname(new URL(downloadUrl).pathname) || ".mp4";
    const fileName = `${crypto
      .randomBytes(16)
      .toString("hex")}${fileExtension}`;
    const filePath = path.join(uploadsDir, fileName);

    // Download the file
    await downloadFile(downloadUrl, filePath);

    // Generate response URL
    const serverBaseUrl = `${req.protocol}://${req.get("host")}`;
    const fileUrl = `${serverBaseUrl}/uploads/${fileName}`;

    res.json({
      videoUrl: fileUrl,
      originalUrl: downloadUrl,
      fileName: fileName,
      expiresIn: "5 minutes",
    });
  } catch (error) {
    console.error("Download error:", error);
    res
      .status(500)
      .json({ error: "Internal Server Error", message: error.message });
  }
});

// Serve uploaded files
app.use("/uploads", express.static(uploadsDir));

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// Run cleanup at startup
cleanupOldFiles();
