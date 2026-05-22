import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { spawn, execFile } from 'child_process';
import ytDlp from 'yt-dlp-exec';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Resolve yt-dlp binary path ───────────────────────────────────────────────
// Cara aman tanpa import internal dari node_modules
let YTDLP_BIN = 'yt-dlp'; // fallback ke PATH sistem

try {
  // yt-dlp-exec menyimpan binary di folder ini
  const { default: ytDlpPath } = await import('yt-dlp-exec/src/constants.js').catch(() => ({}));
  if (ytDlpPath?.YOUTUBE_DL_PATH) {
    YTDLP_BIN = ytDlpPath.YOUTUBE_DL_PATH;
  }
} catch (_) {}

// Verifikasi binary ada dan bisa jalan
try {
  await new Promise((res, rej) => {
    execFile(YTDLP_BIN, ['--version'], (err, stdout) => {
      if (err) rej(err); else res(stdout.trim());
    });
  }).then(v => console.log(`[yt-dlp binary] ${YTDLP_BIN} — v${v}`));
} catch {
  console.warn(`[yt-dlp] Binary di "${YTDLP_BIN}" tidak bisa jalan, fallback ke PATH sistem`);
  YTDLP_BIN = 'yt-dlp';
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function isTikTok(url)  { return /tiktok\.com|vm\.tiktok\.com/.test(url); }
function isYouTube(url) { return /youtube\.com|youtu\.be/.test(url); }

function cleanTikTokUrl(url) {
  try { const p = new URL(url); return p.origin + p.pathname; }
  catch { return url; }
}

// Common headers biar tidak kena block
const YT_HEADERS = [
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  '--add-header', 'Accept-Language:en-US,en;q=0.9',
];

// ─── TikTok: info ─────────────────────────────────────────────────────────────

app.get('/api/download', async (req, res) => {
  let videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ code: -1, msg: 'URL tidak boleh kosong' });

  videoUrl = cleanTikTokUrl(videoUrl);

  try {
    const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}&hd=1`);
    if (!r.ok) throw new Error(`TikWM ${r.status}`);
    return res.json(await r.json());
  } catch (err) {
    console.error('[TikTok]', err.message);
    return res.status(500).json({ code: -500, msg: 'Gagal mengambil data TikTok.', error: err.message });
  }
});

// ─── TikTok: stream proxy ─────────────────────────────────────────────────────

app.get('/api/stream', async (req, res) => {
  const fileUrl = req.query.url;
  const filename = (req.query.filename || 'tiktok_video.mp4').replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (!fileUrl) return res.status(400).send('URL kosong');

  try {
    const upstream = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.tiktok.com/'
      }
    });
    if (!upstream.ok) throw new Error(`CDN ${upstream.status}`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('[Stream]', err.message);
    if (!res.headersSent) res.status(500).send('Gagal: ' + err.message);
  }
});

// ─── YouTube: info ────────────────────────────────────────────────────────────

app.get('/api/youtube/info', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl || !isYouTube(videoUrl))
    return res.status(400).json({ success: false, msg: 'URL YouTube tidak valid' });

  try {
    // Gunakan yt-dlp-exec dengan extra args lewat raw spawn
    // supaya bisa inject headers & ekstrak format dengan benar
    const meta = await ytDlp(videoUrl, {
      dumpJson: true,
      noPlaylist: true,
      noCheckCertificates: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      // extractor-args bypass beberapa pengecekan YouTube
      extractorArgs: 'youtube:player_client=android,web',
    });

    // Filter format: ambil format video yang punya video+audio ATAU video saja
    // Prioritaskan yang sudah merged (bukan DASH-only)
    const seen = new Set();
    const formats = [];

    const sorted = (meta.formats || []).sort((a, b) => (b.height || 0) - (a.height || 0));

    for (const f of sorted) {
      const hasVideo = f.vcodec && f.vcodec !== 'none';
      const hasAudio = f.acodec && f.acodec !== 'none';

      // Format yang sudah lengkap (video+audio) — langsung bisa download
      if (f.ext === 'mp4' && f.height && hasVideo && hasAudio && !seen.has(f.height)) {
        seen.add(f.height);
        formats.push({
          format_id: f.format_id,
          label: `${f.height}p`,
          height: f.height,
          merged: true,
        });
        if (formats.length >= 5) break;
      }
    }

    // Kalau tidak ada format merged, pakai format video saja (akan di-merge saat download)
    if (formats.length === 0) {
      for (const f of sorted) {
        const hasVideo = f.vcodec && f.vcodec !== 'none';
        if ((f.ext === 'mp4' || f.ext === 'webm') && f.height && hasVideo && !seen.has(f.height)) {
          seen.add(f.height);
          formats.push({
            format_id: f.format_id,
            label: `${f.height}p`,
            height: f.height,
            merged: false,
          });
          if (formats.length >= 5) break;
        }
      }
    }

    return res.json({
      success: true,
      data: {
        id: meta.id,
        title: meta.title,
        thumbnail: meta.thumbnail,
        duration: meta.duration,
        uploader: meta.uploader,
        channel: meta.channel,
        view_count: meta.view_count,
        like_count: meta.like_count,
        formats: formats.length ? formats : [{ format_id: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]', label: 'Best Quality', height: 0, merged: false }]
      }
    });
  } catch (err) {
    console.error('[YT info]', err.message);

    // Pesan error yang lebih informatif
    let msg = 'Gagal menganalisis video YouTube.';
    if (err.message.includes('Sign in') || err.message.includes('bot')) {
      msg = 'YouTube memblokir permintaan. Coba beberapa saat lagi.';
    } else if (err.message.includes('unavailable') || err.message.includes('private')) {
      msg = 'Video tidak tersedia atau bersifat privat.';
    } else if (err.message.includes('copyright')) {
      msg = 'Video tidak bisa diunduh karena pembatasan hak cipta.';
    }

    return res.status(500).json({ success: false, msg, detail: err.message });
  }
});

// ─── YouTube: download stream ─────────────────────────────────────────────────

app.get('/api/youtube/download', (req, res) => {
  const videoUrl = req.query.url;
  const fmt      = req.query.fmt     || 'mp4';
  const quality  = req.query.quality || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]';

  if (!videoUrl || !isYouTube(videoUrl))
    return res.status(400).send('URL YouTube tidak valid');

  let ytArgs, filename, contentType;

  if (fmt === 'mp3') {
    ytArgs = [
      ...YT_HEADERS,
      '--no-check-certificates',
      '--extractor-args', 'youtube:player_client=android,web',
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '-o', '-',
      '--no-playlist',
      videoUrl,
    ];
    filename    = `youtube_audio_${Date.now()}.mp3`;
    contentType = 'audio/mpeg';
  } else {
    // Bangun format string yang robust
    // Kalau quality adalah format_id numerik (misal "137"), gabungkan dengan audio
    let fmtStr;
    if (/^\d+$/.test(quality)) {
      // Format ID numerik — gabungkan dengan audio terbaik
      fmtStr = `${quality}+bestaudio[ext=m4a]/${quality}+bestaudio/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
    } else if (quality === 'best' || quality.startsWith('best')) {
      fmtStr = `bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best`;
    } else {
      // Format string sudah lengkap, pakai apa adanya dengan fallback
      fmtStr = `${quality}/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
    }

    ytArgs = [
      ...YT_HEADERS,
      '--no-check-certificates',
      '--extractor-args', 'youtube:player_client=android,web',
      '-f', fmtStr,
      '--merge-output-format', 'mp4',
      '-o', '-',
      '--no-playlist',
      videoUrl,
    ];
    filename    = `youtube_video_${Date.now()}.mp4`;
    contentType = 'video/mp4';
  }

  console.log('[YT DL]', YTDLP_BIN, 'quality:', quality, 'url:', videoUrl);

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);

  const child = spawn(YTDLP_BIN, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  child.stdout.pipe(res);

  let stderrBuf = '';
  child.stderr.on('data', d => {
    const txt = d.toString();
    stderrBuf += txt;
    process.stderr.write(d);
  });

  child.on('close', code => {
    if (code !== 0 && !res.headersSent) {
      console.error('[YT DL] exit code', code, stderrBuf.slice(-300));
      res.status(500).send('Download gagal. Coba lagi nanti.');
    }
  });

  child.on('error', err => {
    console.error('[YT spawn]', err.message);
    if (!res.headersSent) res.status(500).send('Error: ' + err.message);
  });

  req.on('close', () => {
    if (!child.killed) child.kill();
  });
});

// ─── Update yt-dlp otomatis (opsional, jalankan sekali saat start) ─────────────

async function tryUpdateYtDlp() {
  try {
    await new Promise((res, rej) => {
      const p = spawn(YTDLP_BIN, ['-U'], { stdio: 'pipe' });
      p.on('close', code => code === 0 || code === 1 ? res() : rej(new Error(`exit ${code}`)));
      p.on('error', rej);
    });
    console.log('[yt-dlp] Update selesai');
  } catch (err) {
    console.warn('[yt-dlp] Gagal update (tidak fatal):', err.message);
  }
}

// Update di background, jangan blokir server startup
tryUpdateYtDlp();

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` TikSave aktif → http://localhost:${PORT}`);
  console.log(`==================================================`);
});
