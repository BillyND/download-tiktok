# Douyin Video Downloader

Douyin Video Downloader is a Node.js application that allows users to download Douyin (TikTok) videos without a watermark. The application provides a simple web interface for users to input video URLs and download videos directly to their devices.

## Features

- Download Douyin/TikTok videos without watermark
- Simple and intuitive web interface
- Option to specify a custom filename for downloads
- Automatic cleanup of old files

## Technologies Used

- **Node.js**: Backend server
- **Express**: Web framework for Node.js
- **Axios**: Promise-based HTTP client
- **JSDOM**: JavaScript implementation of the DOM
- **Node-fetch**: Lightweight module that brings `window.fetch` to Node.js
- **Tailwind CSS**: Utility-first CSS framework for styling
- **Font Awesome**: Icon library for web projects

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/BillyND/download-tiktok.git
   cd download-tiktok
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Create a `.env` file:**

   Create a `.env` file in the root directory and add the following environment variables:

   ```plaintext
   PORT=3000
   SERVICE_API_URL=your_service_api_url
   ```

4. **Start the server:**

   For development with auto-reloading:

   ```bash
   npm run dev
   ```

   For production:

   ```bash
   npm start
   ```

5. **Access the application:**

   Open your web browser and go to `http://localhost:3000`.

## Usage

1. Copy the video link from the Douyin or TikTok app.
2. Paste the URL into the input field on the web interface.
3. Optionally, enter a custom filename.
4. Click "Get Video" to process the video.
5. Click "Download Video" to save it to your device.

## License

This project is licensed under the ISC License.

## Author

Developed by [Your Name].
