#!/usr/bin/env python3
import os
import sys
import json
import urllib.request
import urllib.parse
import re

def clean_filename(filename):
    # Membersihkan nama file agar aman digunakan di Windows/macOS/Linux
    return re.sub(r'[^a-zA-Z0-9_.-]', '_', filename)

def download_progress(block_num, block_size, total_size):
    # Menampilkan progress bar di terminal saat proses download berjalan
    if total_size > 0:
        downloaded = block_num * block_size
        percent = min(100, (downloaded * 100) / total_size)
        downloaded_mb = downloaded / (1024 * 1024)
        total_mb = total_size / (1024 * 1024)
        sys.stdout.write(f"\rMengunduh: {percent:.1f}% ({downloaded_mb:.2f} MB / {total_mb:.2f} MB)")
    else:
        downloaded = block_num * block_size
        downloaded_mb = downloaded / (1024 * 1024)
        sys.stdout.write(f"\rMengunduh: {downloaded_mb:.2f} MB")
    sys.stdout.flush()

def main():
    print("==================================================")
    print("      TIKTOK VIDEO DOWNLOADER (CLI Python)        ")
    print("==================================================")
    
    # Ambil URL dari argumen baris perintah atau input interaktif
    if len(sys.argv) > 1:
        video_url = sys.argv[1]
    else:
        try:
            video_url = input("Masukkan tautan video TikTok: ")
        except (KeyboardInterrupt, EOFError):
            print("\nBatal.")
            return

    video_url = video_url.strip()
    if not video_url:
        print("Error: Tautan video tidak boleh kosong.")
        return

    print("\nMenganalisis video, mohon tunggu...")
    
    try:
        # Panggil TikWM API
        api_url = f"https://www.tikwm.com/api/?url={urllib.parse.quote(video_url)}&hd=1"
        req = urllib.request.Request(
            api_url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())

        if data.get('code') != 0 or 'data' not in data:
            print(f"Error dari API: {data.get('msg', 'Gagal menganalisis link. Pastikan link benar.')}")
            return

        video_data = data['data']
        author = video_data.get('author', {}).get('nickname', 'User')
        unique_id = video_data.get('author', {}).get('unique_id', 'anonymous')
        title = video_data.get('title', 'video_tiktok')
        video_id = video_data.get('id', 'no_id')

        # Bersihkan deskripsi video untuk nama file
        short_title = title[:30] if title else "video_tiktok"
        safe_title = clean_filename(short_title)
        
        print("--------------------------------------------------")
        print(f"Pembuat   : {author} (@{unique_id})")
        print(f"Deskripsi : {title[:60] + '...' if len(title) > 60 else title}")
        print(f"Jumlah    : ❤️  {video_data.get('digg_count')} | 💬 {video_data.get('comment_count')} | 👁️ {video_data.get('play_count')}")
        print("--------------------------------------------------")

        # Pilih resolusi (HD diutamakan)
        download_url = video_data.get('hdplay') or video_data.get('play')
        if not download_url:
            print("Error: Link download video tidak ditemukan.")
            return

        filename = f"{safe_title}_{video_id}_no_wm.mp4"
        print(f"Menyimpan ke: {filename}")
        
        # Mulai download
        urllib.request.urlretrieve(download_url, filename, download_progress)
        print("\nUnduhan Selesai!")
        print(f"Sukses! Video berhasil disimpan ke:\n-> {os.path.abspath(filename)}")

        # Opsi download musik MP3
        music_url = video_data.get('music')
        if music_url:
            try:
                music_option = input("\nApakah Anda ingin mengunduh audio MP3 juga? (y/n): ")
            except (KeyboardInterrupt, EOFError):
                music_option = 'n'
            
            if music_option.strip().lower() == 'y':
                audio_filename = f"{safe_title}_{video_id}.mp3"
                print(f"Menyimpan audio ke: {audio_filename}")
                urllib.request.urlretrieve(music_url, audio_filename, download_progress)
                print("\nUnduhan Audio Selesai!")
                print(f"Sukses! Audio berhasil disimpan ke:\\n-> {os.path.abspath(audio_filename)}")

        print("\nTerima kasih telah menggunakan TikSave Python Downloader!")

    except Exception as e:
        print(f"\nTerjadi Kesalahan: {e}")

if __name__ == "__main__":
    main()
