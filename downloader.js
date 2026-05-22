#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

// Helper to ask user for input in terminal if not provided as argument
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans);
  }));
}

// Function to download a file from a URL to a local destination
async function downloadFile(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
  
  const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
  const fileStream = fs.createWriteStream(destPath);
  
  if (!response.body) {
    throw new Error('Response body is empty');
  }

  const reader = response.body.getReader();
  let downloadedBytes = 0;
  
  // Custom progress reporter
  const nodeStream = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
        return;
      }
      downloadedBytes += value.length;
      if (totalBytes > 0) {
        const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
        process.stdout.write(`\rMengunduh: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(2)} MB / ${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
      } else {
        process.stdout.write(`\rMengunduh: ${(downloadedBytes / 1024 / 1024).toFixed(2)} MB`);
      }
      this.push(value);
    }
  });

  nodeStream.pipe(fileStream);
  await finished(fileStream);
  console.log('\nUnduhan Selesai!');
}

async function main() {
  console.log(`================================================`);
  console.log(`   TIKTOK VIDEO DOWNLOADER (CLI Node.js)        `);
  console.log(`================================================`);

  // Get URL from command line arguments or prompt user
  let videoUrl = process.argv[2];
  if (!videoUrl) {
    videoUrl = await askQuestion('Masukkan tautan video TikTok: ');
  }

  videoUrl = videoUrl.trim();
  if (!videoUrl) {
    console.log('Error: Tautan video tidak boleh kosong.');
    process.exit(1);
  }

  console.log('\nMenganalisis video, mohon tunggu...');
  
  try {
    const apiEndpoint = `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}&hd=1`;
    const response = await fetch(apiEndpoint);
    
    if (!response.ok) {
      throw new Error(`TikWM API merespon dengan status: ${response.status}`);
    }

    const result = await response.json();

    if (result.code !== 0 || !result.data) {
      throw new Error(result.msg || 'Gagal mendownload data. Link tidak valid.');
    }

    const data = result.data;
    const author = data.author?.nickname || data.author?.unique_id || 'User';
    const title = data.title || 'video_tiktok';
    const id = data.id || Date.now().toString();

    // Clean title for safe filename
    const cleanTitle = title
      .substring(0, 30)
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase();

    console.log(`------------------------------------------------`);
    console.log(`Pembuat   : ${author} (@${data.author?.unique_id || ''})`);
    console.log(`Deskripsi : ${title.substring(0, 60)}${title.length > 60 ? '...' : ''}`);
    console.log(`Jumlah    : ❤️  ${data.digg_count} | 💬 ${data.comment_count} | 👁️ ${data.play_count}`);
    console.log(`------------------------------------------------`);

    // Choose video download link (HD is preferred)
    const downloadUrl = data.hdplay || data.play;
    if (!downloadUrl) {
      throw new Error('Tidak ada link download video yang ditemukan.');
    }

    const filename = `${cleanTitle}_${id}_no_wm.mp4`;
    const targetPath = path.join(process.cwd(), filename);

    console.log(`Menyimpan ke: ${filename}`);
    await downloadFile(downloadUrl, targetPath);
    console.log(`\nSukses! Video berhasil disimpan ke:\n-> ${targetPath}`);

    // Ask if user wants to download music too
    if (data.music) {
      const musicOption = await askQuestion('\nApakah Anda ingin mengunduh audio MP3 juga? (y/n): ');
      if (musicOption.trim().toLowerCase() === 'y') {
        const audioFilename = `${cleanTitle}_${id}.mp3`;
        const audioPath = path.join(process.cwd(), audioFilename);
        console.log(`Menyimpan audio ke: ${audioFilename}`);
        await downloadFile(data.music, audioPath);
        console.log(`Sukses! Audio berhasil disimpan ke:\n-> ${audioPath}`);
      }
    }

    console.log('\nTerima kasih telah menggunakan TikSave CLI!');

  } catch (error) {
    console.error('\nTerjadi Kesalahan:', error.message);
  }
}

main();
