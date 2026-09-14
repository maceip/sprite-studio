import { spawn } from "node:child_process";

export interface DecodedImage {
  width: number;
  height: number;
  rgba: Buffer;
}

/**
 * Decodes any image Buffer (PNG, JPG, WebP, etc.) into raw RGBA bytes using ffmpeg.
 */
export async function decodeImageToRgba(imageBuffer: Buffer): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    // First get dimensions and decode in one ffmpeg pass using ffprobe or raw ffmpeg probe
    // ffmpeg -i pipe:0 -f rawvideo -pix_fmt rgba pipe:1
    const child = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "info", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    const chunks: Buffer[] = [];
    let stderrOutput = "";

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    child.on("error", (err) => reject(new Error(`Failed to spawn ffmpeg: ${err.message}`)));

    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg decode failed with code ${code}: ${stderrOutput}`));
      }

      // Parse width and height from stderr video stream line: "Stream #0:0... Video: ..., 802x574 ..."
      const match = /(\d{2,5})x(\d{2,5})/.exec(stderrOutput);
      if (!match) {
        return reject(new Error("Could not parse image dimensions from ffmpeg output"));
      }

      const width = parseInt(match[1], 10);
      const height = parseInt(match[2], 10);
      const rgba = Buffer.concat(chunks);

      if (rgba.length !== width * height * 4) {
        return reject(
          new Error(`Decoded RGBA buffer size (${rgba.length}) does not match dimensions ${width}x${height}*4 (${width * height * 4})`)
        );
      }

      resolve({ width, height, rgba });
    });

    child.stdin.end(imageBuffer);
  });
}

/**
 * Encodes raw RGBA bytes into a PNG file on disk using ffmpeg.
 */
export async function writeRgbaToPng(
  rgba: Uint8Array | Buffer,
  width: number,
  height: number,
  outPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-s",
        `${width}x${height}`,
        "-i",
        "pipe:0",
        outPath,
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    child.on("error", (err) => reject(new Error(`Failed to spawn ffmpeg: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg writeRgbaToPng failed with code ${code}`));
    });

    child.stdin.end(Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba));
  });
}

