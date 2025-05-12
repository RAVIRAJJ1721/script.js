const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");

// Execute shell command with increased buffer
const runCommand = async (cmd) => {
    return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Command failed: ${error.message}`);
                console.error(`FFmpeg stderr: ${stderr}`);
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
};

// Delete a file if it exists
const removeFile = async (filePath) => {
    try {
        if (require("fs").existsSync(filePath)) {
            await fs.unlink(filePath);
            console.log(`Removed file: ${filePath}`);
        }
    } catch (err) {
        console.error(`Error removing file ${filePath}: ${err.message}`);
    }
};

// Backup thumbnail to a separate folder
const saveThumbnailBackup = async (thumbnailFile, backupDir) => {
    try {
        await fs.mkdir(backupDir, { recursive: true });
        const backupFile = path.join(backupDir, path.basename(thumbnailFile));
        await fs.copyFile(thumbnailFile, backupFile);
        console.log(`Thumbnail backed up to: ${backupFile}`);
        return backupFile;
    } catch (err) {
        console.error(`Error backing up thumbnail: ${err.message}`);
        return null;
    }
};

// Merge video, audio, and embed thumbnail
const mergeMedia = async (filePaths, backupDir = "/content/BilibiliDownloads/thumbnail_backups") => {
    const { videoFile, audioFile, thumbnailFile, finalOutput } = filePaths;
    try {
        // Verify input files
        if (
            !require("fs").existsSync(videoFile) ||
            !require("fs").existsSync(audioFile) ||
            !require("fs").existsSync(thumbnailFile)
        ) {
            throw new Error("One or more input files are missing.");
        }

        // Backup thumbnail
        console.log("Backing up thumbnail...");
        const backupResult = await saveThumbnailBackup(thumbnailFile, backupDir);
        if (!backupResult) {
            throw new Error("Thumbnail backup failed.");
        }

        // Merge video, audio, and embed thumbnail
        console.log(`Merging into ${finalOutput} with embedded thumbnail...`);
        const ffmpegCmd = `ffmpeg -loglevel error -probesize 10000000 -analyzeduration 10000000 -f mpegts -i "${videoFile}" -f mpegts -i "${audioFile}" -i "${thumbnailFile}" -map 0:v -map 1:a -map 2 -c:v copy -c:a copy -metadata:s:v:0 title="Video Stream" -metadata:s:a:0 title="Audio Stream" -metadata:s:i:0 title="Thumbnail" -disposition:v:0 default -disposition:a:0 default -disposition:2 attached_pic -f mp4 "${finalOutput}"`;
        await runCommand(ffmpegCmd);

        // Verify output file
        if (!require("fs").existsSync(finalOutput)) {
            throw new Error("Merged output file was not created.");
        }
        console.log(`Merge completed: ${finalOutput}`);

        // Signal that the final output is ready for Colab download
        console.log(`Final output ready for download: ${finalOutput}`);

        // Clean up temporary files
        console.log("Cleaning up temporary files...");
        await removeFile(videoFile);
        await removeFile(audioFile);
        await removeFile(thumbnailFile);

        console.log("Merge and cleanup completed successfully.");
        return finalOutput;
    } catch (err) {
        console.error(`Error in mergeMedia: ${err.message}`);
        // Attempt cleanup even on error
        await removeFile(videoFile);
        await removeFile(audioFile);
        await removeFile(thumbnailFile);
        return null;
    }
};

// Main execution
const startMerge = async () => {
    console.log("Bilibili Media Merger");
    const jsonPath = "/content/BilibiliDownloads/file_paths.json";
    const backupDir = "/content/BilibiliDownloads/thumbnail_backups";

    try {
        // Read file paths from JSON
        const filePathsData = await fs.readFile(jsonPath, "utf-8");
        const filePaths = JSON.parse(filePathsData);
        console.log("Loaded file paths:", filePaths);

        const mergeResult = await mergeMedia(filePaths, backupDir);
        if (mergeResult) {
            console.log(`Merge process completed: ${mergeResult}`);
            console.log("Run the Colab Python cell to download the final file.");
        } else {
            console.error("Merge process failed.");
        }
    } catch (err) {
        console.error(`Error in startMerge: ${err.message}`);
    }
};

startMerge();
