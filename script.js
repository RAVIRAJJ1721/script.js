
import axios from "axios";
import readline from "readline";
import fs from 'fs';
import ProgressBar from 'progress';
import { exec } from 'child_process';

const nombre = `
             ██████╗░██╗██╗░░░░░██╗░░░████████╗██╗░░░██╗
             ██╔══██╗██║██║░░░░░██║░░░╚══██╔══╝██║░░░██║
             ██████╦╝██║██║░░░░░██║░░░░░░██║░░░╚██╗░██╔╝
             ██╔══██╗██║██║░░░░░██║░░░░░░██║░░░░╚████╔╝░
             ██████╦╝██║███████╗██║██╗░░░██║░░░░░╚██╔╝░░
             ╚═════╝░╚═╝╚══════╝╚═╝╚═╝░░░╚═╝░░░░░░╚═╝░░░
`;

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
    cookie: cookies,
};

const obtenerValorDespuesDeVideo = (enlace) => {
    try {
        const urlParseada = new URL(enlace);
        const pathSplit = urlParseada.pathname.split('/');

        if (enlace.includes('/video/')) {
            const indiceVideo = pathSplit.indexOf('video');
            return pathSplit[indiceVideo + 1];
        } else if (enlace.includes('/play/')) {
            const numerosDespuesDePlay = pathSplit.filter(segmento => /^\d+$/.test(segmento));
            if (numerosDespuesDePlay.length >= 2) {
                return numerosDespuesDePlay[1];
            } else if (numerosDespuesDePlay.length === 1) {
                console.log('Only one number found after /play/. That value will be used.');
                return numerosDespuesDePlay[0];
            } else {
                console.log('Not enough numbers found after /play/');
                return null;
            }
        } else {
            console.log('Unsupported link type.');
            return null;
        }
    } catch (error) {
        console.error(`Error parsing URL: ${error.message}`);
        return null;
    }
};

const obtenerUrlDeVideoYAudio = async (valor, calidadDeseada = 64) => {
    const regexVideo = /^\d{4,8}$/;
    if (valor) {
        let urlApi;
        if (regexVideo.test(valor)) {
            urlApi = `https://api.bilibili.tv/intl/gateway/web/playurl?ep_id=${valor}&device=wap&platform=web&qn=64&tf=0&type=0`;
        } else {
            urlApi = `https://api.bilibili.tv/intl/gateway/web/playurl?s_locale=en_US&platform=web&aid=${valor}&qn=120`;
        }

        try {
            const respuesta = await axios.get(urlApi, { credentials: "include" });
            const datos = respuesta.data;
            console.log('API Response:', JSON.stringify(datos, null, 2)); // Debug API response

            if (!datos || !datos.data || !datos.data.playurl) {
                console.log('Server response does not contain the expected structure.');
                return null;
            }

            let urlVideo = null;
            let urlAudio = null;

            for (const videoInfo of datos.data.playurl.video) {
                const videoResource = videoInfo.video_resource || {};
                const streamInfo = videoInfo.stream_info || {};
                const calidadVideo = streamInfo.quality || 112;

                if (calidadVideo === 112 && videoResource.url.trim() !== '') {
                    urlVideo = videoResource.url || '';
                    break;
                } else if (calidadVideo === 80 && videoResource.url.trim() !== '') {
                    urlVideo = videoResource.url || '';
                    break;
                } else if (calidadVideo === 64 && videoResource.url.trim() !== '') {
                    urlVideo = videoResource.url || '';
                    break;
                } else if (calidadVideo === 32 && videoResource.url.trim() !== '') {
                    urlVideo = videoResource.url || '';
                    break;
                }
            }

            const audioInfoLista = datos.data.playurl.audio_resource || [];
            if (audioInfoLista.length > 0) {
                const audioInfo = audioInfoLista[0];
                const calidadAudio = audioInfo.quality || 0;
                urlAudio = calidadAudio >= calidadDeseada ? audioInfo.url || '' : null;
            }

            if (urlVideo !== null && urlAudio !== null) {
                return { urlVideo, urlAudio };
            } else {
                console.log(`URL for video or audio with quality ${calidadDeseada} or 64 not found.`);
                return null;
            }
        } catch (error) {
            console.log(`Error getting video and audio URL: ${error.message}`);
            return null;
        }
    } else {
        console.log('No value provided after /video/ or /play/');
        return null;
    }
};

const descargarVideoYAudio = async (enlace, directorioDestino = '.') => {
    const valorDespuesDeVideo = obtenerValorDespuesDeVideo(enlace);
    if (!valorDespuesDeVideo) {
        console.log('Link does not contain the expected "video/" or "play/" part.');
        return null;
    }

    const result = await obtenerUrlDeVideoYAudio(valorDespuesDeVideo);
    if (!result) {
        console.log('Failed to obtain video or audio URLs.');
        return null;
    }

    const { urlVideo, urlAudio } = result;
    if (urlVideo && urlAudio) {
        console.log('¡Links found!');

        const nombreArchivoVideo = `${directorioDestino}/${Math.floor(Math.random() * 1000000)}_video.m4v`;
        const nombreArchivoAudio = `${directorioDestino}/${Math.floor(Math.random() * 1000000)}_audio.mp4`;

        await descargarArchivo(urlVideo, nombreArchivoVideo);
        await descargarArchivo(urlAudio, nombreArchivoAudio);

        const nombreArchivoFinal = `${directorioDestino}/${Math.floor(Math.random() * 1000000)}_final.mp4`;
        const comandoFFmpeg = `ffmpeg -i ${nombreArchivoVideo} -i ${nombreArchivoAudio} -vcodec copy -acodec copy -f mp4 ${nombreArchivoFinal}`;
        await ejecutarComandoShell(comandoFFmpeg);

        console.log(`Files merged as: ${nombreArchivoFinal}\n`);

        await eliminarArchivo(nombreArchivoVideo);
        await eliminarArchivo(nombreArchivoAudio);

        console.log('Temporary video and audio files deleted.');
        return nombreArchivoFinal;
    } else {
        console.log('URL for the desired quality not found.');
        return null;
    }
};

const descargarArchivo = async (url_archivo, nombre_archivo) => {
    try {
        const response = await axios.get(url_archivo, { responseType: 'stream' });
        const totalBytes = parseInt(response.headers['content-length'], 10);
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
        console.error(`Error during file download: ${error.message}`);
        return null;
    }
};

const eliminarArchivo = async (nombreArchivo) => {
    try {
        await fs.promises.unlink(nombreArchivo);
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

const validateUrl = (enlace) => {
    if (!enlace) {
        return 'URL cannot be empty.';
    }
    if (enlace.length > 1000) {
        return 'URL is too long.';
    }
    if (!enlace.startsWith('https://www.bilibili.tv/') && !enlace.startsWith('https://bilibili.tv/')) {
        return 'URL must be a valid bilibili.tv link.';
    }
    if (!enlace.includes('/video/') && !enlace.includes('/play/')) {
        return 'URL must contain /video/ or /play/.';
    }
    return null;
};

const processUrl = async (enlaceOriginal) => {
    const validationError = validateUrl(enlaceOriginal);
    if (validationError) {
        console.error(`Error: ${validationError}`);
        return false;
    }

    const directorioDestino = '/content/drive/MyDrive/BilibiliDownloads';
    if (!fs.existsSync(directorioDestino)) {
        fs.mkdirSync(directorioDestino);
    }

    const logFile = '/content/drive/MyDrive/BilibiliDownloads/download_log.txt';
    if (fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf-8').includes(enlaceOriginal)) {
        console.log(`URL ${enlaceOriginal} already downloaded. Skipping.`);
        return true;
    }

    const result = await descargarVideoYAudio(enlaceOriginal, directorioDestino);
    if (result) {
        fs.appendFileSync(logFile, `${enlaceOriginal} -> ${result}\n`);
    }
    return !!result;
};

// Batch processing from urls.txt
console.log(nombre);
console.log('                     https://github.com/jjaruna \n');

const urlFile = '/content/script/urls.txt';
if (fs.existsSync(urlFile)) {
    const urls = fs.readFileSync(urlFile, 'utf-8').split('\n').filter(url => url.trim());
    const processNext = async (index = 0) => {
        if (index >= urls.length) {
            console.log('All URLs processed.');
            process.exit(0);
        }
        console.log(`Processing URL ${index + 1}/${urls.length}: ${urls[index]}`);
        await processUrl(urls[index]).then((success) => {
            if (success) {
                processNext(index + 1);
            } else {
                console.error(`Failed to process ${urls[index]}. Continuing...`);
                processNext(index + 1);
            }
        });
    };
    processNext();
} else if (process.argv[2]) {
    // Command-line mode (for Google Colab or automation)
    processUrl(process.argv[2]).then((success) => {
        process.exit(success ? 0 : 1);
    });
} else {
    // Interactive mode (for local terminal)
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const promptForUrl = () => {
        rl.question('Enter a bilibili.tv link (e.g., https://www.bilibili.tv/video/12345) or "exit" to quit: ', (enlaceOriginal) => {
            if (enlaceOriginal.toLowerCase() === 'exit') {
                rl.close();
                return;
            }
            processUrl(enlaceOriginal).then(() => promptForUrl());
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
                                      }
