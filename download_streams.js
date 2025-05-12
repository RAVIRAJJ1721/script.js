const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const ProgressBar = require("progress");

// Download a single stream with progress tracking
const fetchMediaStream = async (mediaUrl, backupUrl, filePath, maxRetries = 3) => {
    const urls = [mediaUrl, ...(backupUrl || [])]; // Try primary URL first, then backups
    let lastError = null;

    for (const url of urls) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Attempting to fetch: ${url} (Attempt ${attempt + 1}/${maxRetries + 1})`);
                const response = await axios.get(url, {
                    responseType: "stream",
                    timeout: 600000,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Accept": "*/*",
                        "Referer": "https://www.bilibili.tv/",
                        "Origin": "https://www.bilibili.tv",
                        "Accept-Encoding": "gzip, deflate, br",
                        "Connection": "keep-alive",
                    },
                    validateStatus: (status) => status >= 200 && status < 300,
                });

                const totalSize = parseInt(response.headers["content-length"], 10) || 1000000;
                const progress = new ProgressBar(`Fetching ${path.basename(filePath)} [:bar] :percent :etas`, {
                    complete: "=",
                    incomplete: " ",
                    width: 20,
                    total: totalSize,
                });

                const fileStream = require("fs").createWriteStream(filePath);
                response.data.on("data", (chunk) => progress.tick(chunk.length));
                response.data.pipe(fileStream);

                await new Promise((resolve, reject) => {
                    fileStream.on("finish", resolve);
                    fileStream.on("error", reject);
                });

                console.log(`Media saved to: ${filePath}`);
                return filePath;
            } catch (err) {
                lastError = err;
                const status = err.response ? err.response.status : "Unknown";
                const errorMsg = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
                console.error(`Failed to fetch ${url} (Attempt ${attempt + 1}): Status ${status}, Error: ${errorMsg}`);
                if (attempt < maxRetries) {
                    console.log(`Retrying ${url} (${maxRetries - attempt} attempts left)`);
                }
            }
        }
    }

    console.error(`All attempts failed for ${mediaUrl} and backups: ${lastError.message}`);
    return null;
};

// Process API response and download media
const acquireMedia = async (
    jsonPath,
    thumbnailUrl,
    videoQuality = 64,
    audioQuality = 30280,
    outputDir = "/content/BilibiliDownloads",
    outputFileName = "final_video"
) => {
    try {
        // Read API response from JSON file
        const fileData = await fs.readFile(jsonPath, "utf-8");
        const apiData = JSON.parse(fileData);

        // Validate API response
        if (apiData.code !== 0 || !apiData.data || !apiData.data.playurl) {
            console.error(`Invalid API response: ${apiData.message || "No playurl data"}`);
            console.log("API response:", JSON.stringify(apiData, null, 2));
            return null;
        }

        // Log video streams for debugging
        console.log("Available video streams:", JSON.stringify(apiData.data.playurl.video, null, 2));

        // Select HEV1 codec video URL for 720p (quality 64)
        let videoStream = apiData.data.playurl.video.find(
            (stream) =>
                stream.stream_info.quality === videoQuality &&
                stream.video_resource &&
                stream.video_resource.codecs &&
                typeof stream.video_resource.codecs === "string" &&
                stream.video_resource.codecs.includes("hev")
        );

        // Fallback to any 720p stream if no HEV1 codec is found
        if (!videoStream) {
            console.warn("No HEV1 codec found for quality 64. Falling back to any 720p stream.");
            videoStream = apiData.data.playurl.video.find(
                (stream) => stream.stream_info.quality === videoQuality && stream.video_resource && stream.video_resource.url
            );
        }

        const videoStreamUrl = videoStream ? videoStream.video_resource.url : null;
        const videoBackupUrl = videoStream ? videoStream.video_resource.backup_url : null;

        // Select audio URL for the highest quality
        const audioStream = apiData.data.playurl.audio_resource.find((a) => a.quality === audioQuality);
        const audioStreamUrl = audioStream ? audioStream.url : null;
        const audioBackupUrl = audioStream ? audioStream.backup_url : null;

        if (!videoStreamUrl || !audioStreamUrl || !thumbnailUrl) {
            console.error("Missing video, audio, or thumbnail URL.");
            console.log("Video stream:", videoStream);
            console.log("Audio stream:", audioStream);
            console.log("Thumbnail URL:", thumbnailUrl);
            return null;
        }

        console.log(`Selected video (720p, codecs: ${videoStream.video_resource.codecs}), audio quality ${audioQuality}, and thumbnail`);

        // Create directories
        const thumbnailDir = path.join(outputDir, "thumbnails");
        await fs.mkdir(outputDir, { recursive: true });
        await fs.mkdir(thumbnailDir, { recursive: true });

        // Generate unique file names
        const videoFilePath = path.join(outputDir, `${Math.floor(Math.random() * 1000000)}_video.m4s`);
        const audioFilePath = path.join(outputDir, `${Math.floor(Math.random() * 1000000)}_audio.m4s`);
        const thumbnailFilePath = path.join(thumbnailDir, `${Math.floor(Math.random() * 1000000)}_thumbnail.jpg`);
        const finalOutputPath = path.join(outputDir, `${outputFileName}.mp4`);

        // Download video
        console.log(`Fetching video: ${videoStreamUrl}`);
        const videoResult = await fetchMediaStream(videoStreamUrl, videoBackupUrl, videoFilePath);
        if (!videoResult) {
            throw new Error("Video download failed.");
        }

        // Download audio
        console.log(`Fetching audio: ${audioStreamUrl}`);
        const audioResult = await fetchMediaStream(audioStreamUrl, audioBackupUrl, audioFilePath);
        if (!audioResult) {
            throw new Error("Audio download failed.");
        }

        // Download thumbnail
        console.log(`Fetching thumbnail: ${thumbnailUrl}`);
        const thumbnailResult = await fetchMediaStream(thumbnailUrl, [], thumbnailFilePath); // No backup for thumbnail
        if (!thumbnailResult) {
            throw new Error("Thumbnail download failed.");
        }

        // Verify files
        if (
            !require("fs").existsSync(videoFilePath) ||
            !require("fs").existsSync(audioFilePath) ||
            !require("fs").existsSync(thumbnailFilePath)
        ) {
            throw new Error("One or more downloaded files are missing.");
        }

        console.log("All media downloaded successfully.");

        // Save file paths to JSON
        const filePaths = {
            videoFile: videoFilePath,
            audioFile: audioFilePath,
            thumbnailFile: thumbnailFilePath,
            finalOutput: finalOutputPath,
        };
        const jsonPathOutput = path.join(outputDir, "file_paths.json");
        await fs.writeFile(jsonPathOutput, JSON.stringify(filePaths, null, 2));
        console.log(`File paths saved to: ${jsonPathOutput}`);

        return filePaths;
    } catch (err) {
        console.error(`Error in acquireMedia: ${err.message}`);
        return null;
    }
};

// Main execution
const startDownload = async () => {
    console.log("Bilibili Media Downloader (HEV1 720p)");
    const jsonPath = "/content/BilibiliDownloads/api.json"; // Path to API response JSON
    const thumbnailUrl = "https://example.com/thumbnail.jpg"; // Replace with actual thumbnail URL
    const outputDir = "/content/BilibiliDownloads"; // Output directory
    const videoQuality = 64; // 720p
    const audioQuality = 30280; // Highest audio quality
    const outputFileName = "my_bilibili_video"; // Custom output file name

    try {
        const downloadResult = await acquireMedia(
            jsonPath,
            thumbnailUrl,
            videoQuality,
            audioQuality,
            outputDir,
            outputFileName
        );
        if (downloadResult) {
            console.log("Download completed. File paths saved for merging:");
            console.log(JSON.stringify(downloadResult, null, 2));
            console.log("Run `!node /content/merge_streams.js` to merge and download the final file.");
        } else {
            console.error("Download failed.");
        }
    } catch (err) {
        console.error(`Error in startDownload: ${err.message}`);
    }
};

startDownload();
