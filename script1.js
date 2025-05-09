%%writefile /content/script/script.js
import axios from "axios";
import readline from "readline";
import fs from 'fs';
import ProgressBar from 'progress';
import { exec } from 'child_process';

const cargarCookiesDesdeArchivo = (rutaArchivo) => {
    try {
        const data = fs.readFileSync(rutaArchivo, 'utf-8');
        const cookiesArray = data.split('\n').map(line => line.trim()).filter(line => line);
        return cookiesArray.join('; ');
    } catch (error) {
        console.error(`Error loading cookies: ${error.message}`);
        return '';
    }
};

const cookies = cargarCookiesDesdeArchivo('/content/script/cookies.txt');

axios.defaults.headers = {
    referer: 'https://www.bilibili.tv/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    cookie: cookies
};

const obtenerUrlDeVideoYAudio = async (valor, calidadDeseada = 64) => {
    try {
        const url = `https://api.bilibili.tv/intl/gateway/web/playurl?s_locale=en_US&platform=web&aid=${valor}&qn=${calidadDeseada}&type=0&device=wap&tf=0&spm_id=bstar-web.ugc-video-detail.0.0&from_spm_id=bstar-web.homepage.recommend.all`;
        const response = await axios.get(url, {
            timeout: 600000,
            headers: {
                'Referer': 'https://www.bilibili.tv/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': cookies,
                'Origin': 'https://www.bilibili.tv',
                'Accept': '*/*'
            }
        });

        if (response.data.code !== 0 || !response.data.data?.playurl) {
            console.error(`API Error: ${response.data.message || 'No playurl data'}`);
            return { videoUrls: [], audioUrl: '' };
        }

        const videoUrls = response.data.data.playurl.video
            .filter(v => v.stream_info.quality === calidadDeseada)
            .map(v => v.video_resource.url);
        const audioUrl = response.data.data.playurl.audio_resource[0]?.url || '';

        return { videoUrls, audioUrl };
    } catch (error) {
        console.error(`Error fetching URLs: ${error.message}`);
        return { videoUrls: [], audioUrl: '' };
    }
};

const descargarVideoYAudio = async (videoUrls, audioUrl, directorioDestino = '/content/drive/MyDrive/BilibiliDownloads') => {
    if (!videoUrls || videoUrls.length === 0 || !audioUrl) {
        console.log('Video or audio URLs missing.');
        return null;
    }

    const nombreArchivoVideoFinal = `${directorioDestino}/${Math.floor(Math.random() * 1000000)}_video.m4v`;
    const nombreArchivoAudio = `${directorioDestino}/${Math.floor(Math.random() * 1000000)}_audio.mp4`;

    try {
        // Download audio
        console.log(`Downloading audio: ${audioUrl}`);
        const audioResult = await descargarArchivo(audioUrl, nombreArchivoAudio);
        if (!audioResult) {
            throw new Error('Failed to download audio.');
        }

        // Handle multiple video parts
        const partFiles = [];
        for (const [index, videoUrl] of videoUrls.entries()) {
            console.log(`Downloading video part ${index + 1}: ${videoUrl}`);
            const nombreArchivoVideoPart = `${directorioDestino}/part_${index + 1}_${Math.floor(Math.random() * 1000000)}.m4v`;
            const videoResult = await descargarArchivo(videoUrl, nombreArchivoVideoPart);
            if (!videoResult) {
                throw new Error(`Failed to download video part ${index + 1}.`);
            }
            partFiles.push(nombreArchivoVideoPart);
        }

        // Concatenate video parts if multiple
        if (partFiles.length > 1) {
            const concatList = partFiles.map(f => `file '${f}'`).join('\n');
            const concatFile = `${directorioDestino}/concat.txt`;
            fs.writeFileSync(concatFile, concatList);
            console.log(`Concatenating ${partFiles.length} video parts...`);
            await ejecutarComandoShell(`ffmpeg -f concat -safe 0 -i ${concatFile} -c copy ${nombreArchivoVideoFinal}`);
            await eliminarArchivo(concatFile);
            for (const partFile of partFiles) {
                await eliminarArchivo(partFile);
            }
        } else {
            // Single part: rename the downloaded file
            console.log(`Single video part downloaded, renaming to ${nombreArchivoVideoFinal}`);
            fs.renameSync(partFiles[0], nombreArchivoVideoFinal);
        }

        // Merge video and audio
        const nombreArchivoFinal = `${directorioDestino}/${Math.floor(Math.random() * 1000000)}_final.mp4`;
        console.log(`Merging video and audio into ${nombreArchivoFinal}`);
        const comandoFFmpeg = `ffmpeg -i ${nombreArchivoVideoFinal} -i ${nombreArchivoAudio} -vcodec copy -acodec copy -f mp4 ${nombreArchivoFinal}`;
        await ejecutarComandoShell(comandoFFmpeg);

        console.log(`Files merged as: ${nombreArchivoFinal}\n`);

        await eliminarArchivo(nombreArchivoVideoFinal);
        await eliminarArchivo(nombreArchivoAudio);

        console.log('Temporary video and audio files deleted.');
        return nombreArchivoFinal;
    } catch (error) {
        console.error(`Error in descargarVideoYAudio: ${error.message}`);
        // Clean up any partial files
        for (const file of [nombreArchivoVideoFinal, nombreArchivoAudio]) {
            await eliminarArchivo(file);
        }
        return null;
    }
};

const descargarArchivo = async (url_archivo, nombre_archivo, retries = 3) => {
    try {
        const response = await axios.get(url_archivo, {
            responseType: 'stream',
            timeout: 600000,
            headers: {
                'Referer': 'https://www.bilibili.tv/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': cookies,
                'Origin': 'https://www.bilibili.tv',
                'Accept': '*/*'
            }
        });
        const totalBytes = parseInt(response.headers['content-length'], 10) || 1000000;
        const bar = new ProgressBar(`Downloading ${nombre_archivo} [:bar] :percent :etas`, {
            complete: '=',
            incomplete: ' ',
            width: 20,
            total: totalBytes
        });

        const writableStream = fs.createWriteStream(nombre_archivo);
        response.data.on('data', (chunk) => {
            bar.tick(chunk.length);
        });
        response.data.pipe(writableStream);

        await new Promise((resolve, reject) => {
            writableStream.on('finish', resolve);
            writableStream.on('error', reject);
        });

        console.log(`File downloaded as: ${nombre_archivo}\n`);
        return nombre_archivo;
    } catch (error) {
        if (retries > 0) {
            console.log(`Retrying download (${retries} attempts left): ${error.message}`);
            return descargarArchivo(url_archivo, nombre_archivo, retries - 1);
        }
        console.error(`Error during file download: ${error.message}`);
        return null;
    }
};

const eliminarArchivo = async (nombreArchivo) => {
    try {
        if (fs.existsSync(nombreArchivo)) {
            await fs.promises.unlink(nombreArchivo);
            console.log(`Deleted file: ${nombreArchivo}`);
        }
    } catch (error) {
        console.log(`Error deleting file ${nombreArchivo}: ${error.message}`);
    }
};

const ejecutarComandoShell = async (comando) => {
    return new Promise((resolve, reject) => {
        exec(comando, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing command: ${error.message}`);
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
};

const obtenerValorDespuesDeVideo = (url) => {
    try {
        const regex = /\/video\/(\d+)/;
        const match = url.match(regex);
        return match ? match[1] : null;
    } catch (error) {
        console.error(`Error extracting video ID: ${error.message}`);
        return null;
    }
};

const validateUrlsJson = (urlData) => {
    return urlData && Array.isArray(urlData.videoUrls) && urlData.videoUrls.length > 0 && urlData.audioUrl && typeof urlData.audioUrl === 'string';
};

const processUrlsFromFile = async (filePath, sourceUrl) => {
    const directorioDestino = '/content/drive/MyDrive/BilibiliDownloads';
    try {
        if (!fs.existsSync(directorioDestino)) {
            fs.mkdirSync(directorioDestino, { recursive: true });
            console.log(`Created directory: ${directorioDestino}`);
        }
    } catch (error) {
        console.error(`Error creating directory ${directorioDestino}: ${error.message}`);
        return false;
    }

    const logFile = '/content/drive/MyDrive/BilibiliDownloads/download_log.txt';

    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        const urlData = JSON.parse(data);
        const videoUrls = urlData.videoUrls || [];
        const audioUrl = urlData.audioUrl || '';

        if (!validateUrlsJson(urlData)) {
            console.log('Invalid urls.json format. Falling back to API.');
            return false;
        }

        if (fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf-8').includes(sourceUrl)) {
            console.log(`Source URL ${sourceUrl} already downloaded. Skipping.`);
            return true;
        }

        console.log('Attempting to use URLs from urls.json');
        const result = await descargarVideoYAudio(videoUrls, audioUrl, directorioDestino);
        if (result) {
            fs.appendFileSync(logFile, `${sourceUrl} -> ${result}\n`);
            console.log(`Logged download: ${sourceUrl} -> ${result}`);
            return true;
        }
        console.log('URLs from urls.json failed. Falling back to API.');
        return false;
    } catch (error) {
        console.error(`Error processing urls.json: ${error.message}. Falling back to API.`);
        return false;
    }
};

console.log('Bilibili Video Downloader\n');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const promptForUrl = async () => {
    rl.question('Enter the video URL (or "exit" to quit): ', async (url) => {
        if (url.toLowerCase() === 'exit') {
            rl.close();
            return;
        }

        const directorioDestino = '/content/drive/MyDrive/BilibiliDownloads';
        try {
            if (!fs.existsSync(directorioDestino)) {
                fs.mkdirSync(directorioDestino, { recursive: true });
                console.log(`Created directory: ${directorioDestino}`);
            }
        } catch (error) {
            console.error(`Error creating directory ${directorioDestino}: ${error.message}`);
            promptForUrl();
            return;
        }

        const logFile = '/content/drive/MyDrive/BilibiliDownloads/download_log.txt';
        const urlFile = '/content/script/urls.json';

        try {
            if (fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf-8').includes(url)) {
                console.log(`Video ${url} already downloaded. Skipping.`);
                promptForUrl();
                return;
            }

            // Try URLs from urls.json first
            let downloadSuccess = false;
            if (fs.existsSync(urlFile)) {
                downloadSuccess = await processUrlsFromFile(urlFile, url);
            }

            // Fallback to API if urls.json fails or is missing
            if (!downloadSuccess) {
                const valor = obtenerValorDespuesDeVideo(url);
                if (!valor) {
                    console.log('Invalid video URL');
                    promptForUrl();
                    return;
                }

                const { videoUrls, audioUrl } = await obtenerUrlDeVideoYAudio(valor, 64);
                if (videoUrls.length === 0 || !audioUrl) {
                    console.log('Failed to retrieve video or audio URLs from API');
                    promptForUrl();
                    return;
                }

                const result = await descargarVideoYAudio(videoUrls, audioUrl, directorioDestino);
                if (result) {
                    fs.appendFileSync(logFile, `${url} -> ${result}\n`);
                    console.log(`Logged download: ${url} -> ${result}`);
                } else {
                    console.log('Download failed via API');
                }
            }
        } catch (error) {
            console.error(`Error processing video: ${error.message}`);
        }

        promptForUrl();
    });
};

rl.on('error', (err) => {
    console.error(`Readline error: ${err.message}`);
    rl.close();
});

rl.on('SIGINT', () => {
    console.log('\nCaught interrupt signal. Exiting.');
    rl.close();
});

rl.on('close', () => {
    console.log('Exiting program.');
    process.exit(0);
});

promptForUrl();
