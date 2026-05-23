import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { spawn, execSync } from 'child_process';
import ytDlp from 'yt-dlp-exec';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Resolve yt-dlp binary path ───────────────────────────────────────────────
function getYtDlpPath() {
  // 1. Cek node_modules/yt-dlp-exec/bin/yt-dlp
  const localBin = path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
  if (fs.existsSync(localBin)) {
    try {
      // pastikan executable
      fs.accessSync(localBin, fs.constants.X_OK);
      return localBin;
    } catch {
      // set executable permission
      try { execSync(`chmod +x "${localBin}"`); return localBin; } catch {}
    }
  }
  // 2. Fallback: yt-dlp di PATH sistem
  try { execSync('which yt-dlp'); return 'yt-dlp'; } catch {}
  // 3. Fallback: python yt-dlp
  try { execSync('which python3 -m yt_dlp'); return null; } catch {}
  return null;
}

// Download binary jika belum ada
async function ensureBinary() {
  const localBin = path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
  const binDir   = path.dirname(localBin);

  if (!fs.existsSync(localBin) || fs.statSync(localBin).size < 1000) {
    console.log('[yt-dlp] Binary tidak ditemukan, mendownload...');
    try {
      fs.mkdirSync(binDir, { recursive: true });
      // Download langsung dari GitHub releases
      execSync(
        `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${localBin}" && chmod +x "${localBin}"`,
        { timeout: 60000, stdio: 'inherit' }
      );
      console.log('[yt-dlp] ✅ Binary berhasil didownload');
    } catch (e) {
      console.error('[yt-dlp] ❌ Gagal download binary:', e.message);
    }
  } else {
    try { execSync(`chmod +x "${localBin}"`); } catch {}
    console.log('[yt-dlp] ✅ Binary ditemukan:', localBin);
  }
}

await ensureBinary();
const YTDLP_BIN = getYtDlpPath();
console.log('[yt-dlp binary]', YTDLP_BIN || 'TIDAK DITEMUKAN');

// ─── Cookies ──────────────────────────────────────────────────────────────────
const COOKIES_PATH = '/etc/secrets/cookies.txt';
const hasCookies   = fs.existsSync(COOKIES_PATH);
console.log('[cookies]', hasCookies ? '✅ cookies.txt ditemukan' : '⚠️  tidak ada');

function cookiesArgs() {
  return hasCookies ? ['--cookies', COOKIES_PATH] : [];
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function isTikTok(url)  { return /tiktok\.com|vm\.tiktok\.com/.test(url); }
function isYouTube(url) { return /youtube\.com|youtu\.be/.test(url); }
function cleanTikTokUrl(url) {
  try { const p = new URL(url); return p.origin + p.pathname; } catch { return url; }
}

// ─── TikTok: info ─────────────────────────────────────────────────────────────
app.get('/api/download', async (req, res) => {
  let videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ code: -1, msg: 'URL kosong' });
  videoUrl = cleanTikTokUrl(videoUrl);
  try {
    const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}&hd=1`);
    if (!r.ok) throw new Error(`TikWM ${r.status}`);
    return res.json(await r.json());
  } catch (err) {
    return res.status(500).json({ code: -500, msg: 'Gagal TikTok.', error: err.message });
  }
});

// ─── TikTok: stream proxy ─────────────────────────────────────────────────────
app.get('/api/stream', async (req, res) => {
  const fileUrl  = req.query.url;
  const filename = (req.query.filename || 'tiktok.mp4').replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (!fileUrl) return res.status(400).send('URL kosong');
  try {
    const upstream = await fetch(fileUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.tiktok.com/' }
    });
    if (!upstream.ok) throw new Error(`CDN ${upstream.status}`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).send('Gagal: ' + err.message);
  }
});

// ─── YouTube: info ────────────────────────────────────────────────────────────
app.get('/api/youtube/info', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl || !isYouTube(videoUrl))
    return res.status(400).json({ success: false, msg: 'URL YouTube tidak valid' });

  if (!YTDLP_BIN)
    return res.status(500).json({ success: false, msg: 'yt-dlp binary tidak ditemukan di server.' });

  try {
    const meta = await ytDlp(videoUrl, {
      dumpJson: true,
      noPlaylist: true,
      ...(hasCookies && { cookies: COOKIES_PATH }),
      addHeader: [
        'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language:en-US,en;q=0.9'
      ]
    });

    const seen = new Set();
    const formats = [];
    for (const f of (meta.formats || []).sort((a,b)=>(b.height||0)-(a.height||0))) {
      if (f.ext === 'mp4' && f.height && !seen.has(f.height)) {
        seen.add(f.height);
        formats.push({ format_id: f.format_id, label: `${f.height}p`, height: f.height });
        if (formats.length >= 5) break;
      }
    }

    return res.json({
      success: true,
      data: {
        id: meta.id, title: meta.title, thumbnail: meta.thumbnail,
        duration: meta.duration, uploader: meta.uploader, channel: meta.channel,
        view_count: meta.view_count, like_count: meta.like_count,
        formats: formats.length ? formats : [{ format_id: 'best', label: 'Best' }]
      }
    });
  } catch (err) {
    console.error('[YT info]', err.message);
    return res.status(500).json({ success: false, msg: 'Gagal menganalisis video YouTube.' });
  }
});

// ─── YouTube: download ────────────────────────────────────────────────────────
app.get('/api/youtube/download', (req, res) => {
  const videoUrl = req.query.url;
  const fmt      = req.query.fmt     || 'mp4';
  const quality  = req.query.quality || 'best';

  if (!videoUrl || !isYouTube(videoUrl)) return res.status(400).send('URL tidak valid');
  if (!YTDLP_BIN) return res.status(500).send('yt-dlp tidak tersedia');

  const baseArgs = [
    '--no-playlist',
    '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    ...cookiesArgs()
  ];

  let ytArgs, filename, contentType;
  if (fmt === 'mp3') {
    ytArgs      = [...baseArgs, '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', '-', videoUrl];
    filename    = `youtube_audio_${Date.now()}.mp3`;
    contentType = 'audio/mpeg';
  } else {
    const fmtStr = quality !== 'best'
      ? `${quality}+bestaudio[ext=m4a]/${quality}/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]`
      : `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]`;
    ytArgs      = [...baseArgs, '-f', fmtStr, '--merge-output-format', 'mp4', '-o', '-', videoUrl];
    filename    = `youtube_video_${Date.now()}.mp4`;
    contentType = 'video/mp4';
  }

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);

  const child = spawn(YTDLP_BIN, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(res);
  child.stderr.on('data', d => process.stderr.write(d));
  child.on('error', err => {
    if (!res.headersSent) res.status(500).send('Error: ' + err.message);
  });
  req.on('close', () => child.kill());
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` TikSave aktif → http://localhost:${PORT}`);
  console.log(`==================================================`);
});
