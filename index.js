const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const https = require("https");
const crypto = require("crypto");
require("dotenv").config();
const fetch = require("node-fetch");

const app = express();
const port = process.env.PORT || 3000;
const MAX_STORAGE_TIME = 300000; // 5 minutes in milliseconds
const SERVICE_API_URL = process.env.SERVICE_API_URL;

// Setup middleware
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
 * @param {string} url - Input URL or text
 * @returns {string|null} - Extracted video URL or null
 */
function extractVideoUrl(url) {
  const urlMatch = url.match(/https[^\s]+/g);
  return urlMatch ? urlMatch[0] : null;
}

/**
 * Fetch token from service page
 * @returns {Promise<string>} - Authentication token
 */
async function fetchToken() {
  try {
    const response = await fetch(SERVICE_API_URL);
    const html = await response.text();
    const dom = new JSDOM(html);

    const tokenElement = dom.window.document.getElementById("token");
    const token = tokenElement ? tokenElement.value : null;

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
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
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
          console.error(`Error getting file info for ${file}:`, err);
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

    // Fetch authentication token
    const token = await fetchToken();
    console.log("token", token);

    // Create FormData string for request body
    const formData = new URLSearchParams();
    formData.append("url", videoUrl);

    // Fetch video data
    const response = await fetch(
      `${SERVICE_API_URL}/wp-json/aio-dl/video-data/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${token}`,
        },
        body: formData.toString(),
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();

    // Get download URL
    const downloadUrl =
      data && data.medias && data.medias.length > 0 ? data.medias[0].url : null;

    console.log("videoUrl: ", videoUrl);
    console.log("downloadUrl: ", downloadUrl);

    if (!downloadUrl) {
      return res
        .status(404)
        .json({ error: "Download URL not found in response" });
    }

    // Kiểm tra kích thước file
    const fileSize = await checkFileSize(downloadUrl);
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes

    // Nếu file lớn hơn 10MB, trả về link ngay
    if (fileSize > MAX_FILE_SIZE) {
      return res.json({
        videoUrl: downloadUrl,
        originalUrl: downloadUrl,
        isDirectLink: true,
        fileSize: formatFileSize(fileSize),
      });
    }

    // Create a unique file name - Node.js 14 requires modification for extension
    let fileExtension = ".mp4"; // Default
    try {
      const urlObj = new URL(downloadUrl);
      const pathname = urlObj.pathname;
      const extname = path.extname(pathname);
      if (extname) fileExtension = extname;
    } catch (e) {
      console.error("Error parsing URL:", e);
    }

    const fileName = `${crypto
      .randomBytes(16)
      .toString("hex")}${fileExtension}`;
    const filePath = path.join(uploadsDir, fileName);

    // Download file
    await downloadFile(downloadUrl, filePath);

    // Create response URL
    const serverBaseUrl = `https://${req.get("host")}`;
    const fileUrl = `${serverBaseUrl}/uploads/${fileName}`;

    res.json({
      videoUrl: fileUrl,
      originalUrl: downloadUrl,
      fileName: fileName,
      expiresIn: "5 minutes",
      fileSize: formatFileSize(fileSize),
    });
  } catch (error) {
    console.error("Download error:", error);
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  }
});

// Hàm kiểm tra kích thước file từ URL
async function checkFileSize(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok)
      throw new Error(`Error checking file size: ${response.statusText}`);

    const contentLength = response.headers.get("content-length");
    return contentLength ? parseInt(contentLength, 10) : 0;
  } catch (error) {
    console.error("Error getting file size:", error);
    return 0; // Trả về 0 nếu không thể xác định kích thước
  }
}

// Hàm format kích thước file
function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Serve uploaded files
app.use("/uploads", express.static(uploadsDir));

// Start server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

// Run cleanup on startup
cleanupOldFiles();
