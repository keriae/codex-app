const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const videoPath = path.resolve(process.argv[2]);
const outputPath = path.resolve(process.argv[3]);
const times = process.argv.slice(4).map(Number);

if (!videoPath || !outputPath || times.length === 0 || times.some(Number.isNaN)) {
  throw new Error("usage: electron extract-video-frames.cjs VIDEO OUTPUT TIME...");
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: { webSecurity: false },
  });
  const src = pathToFileURL(videoPath).href;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <style>html,body{margin:0;background:#000}video{display:none}</style>
    <video preload="auto" src="${src}"></video>
  `)}`);
  const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const video = document.querySelector('video');
    if (video.readyState < 1) {
      await new Promise((resolve, reject) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        video.addEventListener('error', reject, { once: true });
      });
    }
    const singleFrame = ${times.length} === 1;
    const cellWidth = singleFrame ? 3878 : 969;
    const cellHeight = singleFrame ? 2282 : 571;
    const columns = Math.min(4, ${times.length});
    const rows = Math.ceil(${times.length} / columns);
    const canvas = document.createElement('canvas');
    canvas.width = cellWidth * columns;
    canvas.height = cellHeight * rows;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const times = ${JSON.stringify(times)};
    for (let index = 0; index < times.length; index += 1) {
      const time = times[index];
      video.currentTime = time;
      await new Promise((resolve, reject) => {
        video.addEventListener('seeked', resolve, { once: true });
        video.addEventListener('error', reject, { once: true });
      });
      const x = (index % columns) * cellWidth;
      const y = Math.floor(index / columns) * cellHeight;
      ctx.drawImage(video, x, y, cellWidth, cellHeight);
      ctx.fillStyle = 'rgba(0,0,0,.72)';
      ctx.fillRect(x + 10, y + 10, 132, 42);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 27px -apple-system, sans-serif';
      ctx.fillText(time.toFixed(3) + 's', x + 20, y + 40);
    }
    return canvas.toDataURL('image/png');
  })()`);
  fs.writeFileSync(outputPath, Buffer.from(dataUrl.split(",")[1], "base64"));
  win.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
