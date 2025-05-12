const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const ProgressBar = require("progress");

// Download a single stream with progress tracking
const fetchMediaStream = async (mediaUrl, filePath, maxRetries = 3) => {
    try {
        const response = await axios.get(mediaUrl, {
            responseType: "stream",
            timeout: 600000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Referer": "https://www.bilibili.tv/",
            },
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
        if (maxRetries > 0) {
            console.log(`Retrying fetch (${maxRetries} attempts left): ${err.message}`);
            return fetchMediaStream(mediaUrl, filePath, maxRetries - 1);
        }
        console.error(`Failed to fetch media: ${err.message}`);
        return null;
    }
};

// Process API response and download media
const acquireMedia = async (
    apiUrl,
    thumbnailUrl,
    videoQuality = 64,
    audioQuality = 30280,
    outputDir = "/content/BilibiliDownloads",
    outputFileName = "final_video"
) => {
    try {
        // Fetch API response
        const response = await axios.get(apiUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json",
            },
        });

        const apiData = response.data;

        // Validate API response
        if (apiData.code !== 0 || !apiData.data || !apiData.data.playurl) {
            console.error(`Invalid API response: ${apiData.message || "No playurl data"}`);
            return null;
        }

        // Select HEV1 codec video URL for 720p (quality 64)
        const videoStream = apiData.data.playurl.video.find(
            (stream) => stream.stream_info.quality === videoQuality && stream.video_resource.codec.includes("hev")
        );
        const videoStreamUrl = videoStream ? videoStream.video_resource.url : null;

        // Select audio URL for the highest quality
        const audioStream = apiData.data.playurl.audio_resource.find((a) => a.quality === audioQuality);
        const audioStreamUrl = audioStream ? audioStream.url : null;

        if (!videoStreamUrl || !audioStreamUrl || !thumbnailUrl) {
            console.error("Missing HEV1 video, audio, or thumbnail URL.");
            return null;
        }

        console.log(`Selected HEV1 video (720p), audio quality ${audioQuality}, and thumbnail`);

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
        const videoResult = await fetchMediaStream(videoStreamUrl, videoFilePath);
        if (!videoResult) {
            throw new Error("Video download failed.");
        }

        // Download audio
        console.log(`Fetching audio: ${audioStreamUrl}`);
        const audioResult = await fetchMediaStream(audioStreamUrl, audioFilePath);
        if (!audioResult) {
            throw new Error("Audio download failed.");
        }

        // Download thumbnail
        console.log(`Fetching thumbnail: ${thumbnailUrl}`);
        const thumbnailResult = await fetchMediaStream(thumbnailUrl, thumbnailFilePath);
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
        const jsonPath = path.join(outputDir, "file_paths.json");
        await fs.writeFile(jsonPath, JSON.stringify(filePaths, null, 2));
        console.log(`File paths saved to: ${jsonPath}`);

        return filePaths;
    } catch (err) {
        console.error(`Error in acquireMedia: ${err.message}`);
        return null;
    }
};

// Main execution
const startDownload = async () => {
    console.log("Bilibili Media Downloader (HEV1 720p)");
    const apiUrl = "https://example.com/api/bilibili"; // Replace with actual API URL
    const thumbnailUrl = "https://example.com/thumbnail.jpg"; // Replace with actual thumbnail URL
    const outputDir = "/content/BilibiliDownloads";
    const videoQuality = 64; // 720p
    const audioQuality = 30280; // Highest audio quality
    const outputFileName = "my_bilibili_video"; // Custom output file name

    try {
        const downloadResult = await acquireMedia(
            apiUrl,
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
