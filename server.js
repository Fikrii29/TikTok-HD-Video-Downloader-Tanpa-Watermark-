import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoint untuk mengambil info video TikTok dari TikWM
app.get('/api/download', async (req, res) => {
  const videoUrl = req.query.url;

  if (!videoUrl) {
    return res.status(400).json({ code: -1, msg: 'URL TikTok tidak boleh kosong' });
  }

  try {
    // Memanggil TikWM API dengan parameter hd=1 untuk mendapatkan video HD jika tersedia
    const tikwmApiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}&hd=1`;
    const response = await fetch(tikwmApiUrl);
    
    if (!response.ok) {
      throw new Error(`TikWM API merespon dengan status: ${response.status}`);
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error('Error fetching from TikWM:', error);
    return res.status(500).json({
      code: -500,
      msg: 'Gagal mengambil data dari TikTok. Pastikan link benar atau coba lagi nanti.',
      error: error.message
    });
  }
});

// Stream endpoint untuk mendownload file (video/audio) secara langsung demi menghindari CORS
// dan memaksa download (Content-Disposition: attachment)
app.get('/api/stream', async (req, res) => {
  const fileUrl = req.query.url;
  let filename = req.query.filename || 'tiktok_video.mp4';

  if (!fileUrl) {
    return res.status(400).send('URL file tidak boleh kosong');
  }

  // Bersihkan nama file agar aman
  filename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');

  try {
    const response = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/'
      }
    });

    if (!response.ok) {
      throw new Error(`Gagal mengunduh file dari CDN dengan status: ${response.status}`);
    }

    // Set headers untuk memaksa download file di browser
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Pipe stream response ke express response
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body);
      nodeStream.pipe(res);
    } else {
      res.status(500).send('Respon body kosong');
    }
  } catch (error) {
    console.error('Error streaming file:', error);
    if (!res.headersSent) {
      res.status(500).send(`Gagal mendownload file: ${error.message}`);
    }
  }
});

// Mulai Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` TikTok Downloader Server aktif!`);
  console.log(` Buka browser Anda: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
