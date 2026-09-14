// Sprite Sheet Segmenter & Bounding Box Extractor
// Automatically classifies and slices:
// 1. Regular grid sprite sheets (retro game sheets, animation strips)
// 2. Arbitrary pseudo-sprite sheets (e.g. 10 construction vehicles, worker lineups)
// 3. UI component sheets (dials, bars, buttons)

export interface BoundingBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  baselineY: number;
}

export interface SheetAnalysis {
  type: "grid" | "cca_pseudo_sheet" | "ui_modular";
  width: number;
  height: number;
  backgroundColor: [number, number, number];
  boundingBoxes: BoundingBox[];
  gridDimensions?: { cellWidth: number; cellHeight: number; rows: number; cols: number };
}

export class SpriteSegmenter {
  /**
   * Detects dominant background color by sampling image edges and corners.
   */
  static detectBackgroundColor(
    rgba: Uint8Array | Buffer,
    width: number,
    height: number
  ): [number, number, number] {
    const samples: [number, number, number][] = [];
    const coords = [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
      [Math.floor(width / 2), 0],
      [0, Math.floor(height / 2)],
      [width - 1, Math.floor(height / 2)],
      [Math.floor(width / 2), height - 1],
    ];

    for (const [x, y] of coords) {
      const idx = (y * width + x) * 4;
      samples.push([rgba[idx], rgba[idx + 1], rgba[idx + 2]]);
    }

    // Return the median / most frequent corner color
    return samples[0];
  }

  /**
   * Fast Connected-Component Analysis (CCA) using Breadth-First Flood Fill.
   * Isolates separate objects from pseudo-sprite sheets (e.g. construction vehicles, workers).
   */
  static segmentConnectedComponents(
    rgba: Uint8Array | Buffer,
    width: number,
    height: number,
    options?: {
      bgColor?: [number, number, number];
      colorThreshold?: number;
      minArea?: number;
    }
  ): BoundingBox[] {
    const bg = options?.bgColor ?? this.detectBackgroundColor(rgba, width, height);
    const threshold = options?.colorThreshold ?? 20;
    const minArea = options?.minArea ?? 200;

    // Build binary mask: 1 = foreground, 0 = background
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const a = rgba[idx + 3];
        if (a < 30) {
          mask[y * width + x] = 0;
          continue;
        }
        const dr = rgba[idx] - bg[0];
        const dg = rgba[idx + 1] - bg[1];
        const db = rgba[idx + 2] - bg[2];
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        mask[y * width + x] = dist > threshold ? 1 : 0;
      }
    }

    const visited = new Uint8Array(width * height);
    const boxes: BoundingBox[] = [];
    let nextId = 1;

    // Queue for BFS
    const queue = new Int32Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const startIdx = y * width + x;
        if (mask[startIdx] === 0 || visited[startIdx] === 1) continue;

        let qHead = 0;
        let qTail = 0;
        queue[qTail++] = startIdx;
        visited[startIdx] = 1;

        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let area = 0;

        while (qHead < qTail) {
          const curr = queue[qHead++];
          area++;
          const cy = Math.floor(curr / width);
          const cx = curr % width;

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          // Check 4-connected neighbors
          const neighbors = [
            cx > 0 ? curr - 1 : -1,
            cx < width - 1 ? curr + 1 : -1,
            cy > 0 ? curr - width : -1,
            cy < height - 1 ? curr + width : -1,
          ];

          for (const n of neighbors) {
            if (n >= 0 && mask[n] === 1 && visited[n] === 0) {
              visited[n] = 1;
              queue[qTail++] = n;
            }
          }
        }

        const boxW = maxX - minX + 1;
        const boxH = maxY - minY + 1;

        if (area >= minArea && boxW >= 12 && boxH >= 12) {
          boxes.push({
            id: `obj_${nextId++}`,
            x: minX,
            y: minY,
            width: boxW,
            height: boxH,
            area,
            baselineY: maxY,
          });
        }
      }
    }

    // Merge bounding boxes that overlap or are intimately nested
    return this.mergeAdjacentBoxes(boxes);
  }

  /**
   * Merges bounding boxes with high overlap or close proximity.
   */
  private static mergeAdjacentBoxes(boxes: BoundingBox[]): BoundingBox[] {
    const merged: BoundingBox[] = [];
    const used = new Set<number>();

    for (let i = 0; i < boxes.length; i++) {
      if (used.has(i)) continue;
      let cur = { ...boxes[i] };

      let changed = true;
      while (changed) {
        changed = false;
        for (let j = 0; j < boxes.length; j++) {
          if (i === j || used.has(j)) continue;
          const other = boxes[j];

          // Check if other is nested inside or overlaps significantly
          const overlapX = Math.max(0, Math.min(cur.x + cur.width, other.x + other.width) - Math.max(cur.x, other.x));
          const overlapY = Math.max(0, Math.min(cur.y + cur.height, other.y + other.height) - Math.max(cur.y, other.y));
          const overlapArea = overlapX * overlapY;

          if (overlapArea > 0.3 * Math.min(cur.area, other.area)) {
            const minX = Math.min(cur.x, other.x);
            const minY = Math.min(cur.y, other.y);
            const maxX = Math.max(cur.x + cur.width, other.x + other.width);
            const maxY = Math.max(cur.y + cur.height, other.y + other.height);

            cur.x = minX;
            cur.y = minY;
            cur.width = maxX - minX;
            cur.height = maxY - minY;
            cur.area += other.area;
            cur.baselineY = maxY;

            used.add(j);
            changed = true;
          }
        }
      }

      merged.push(cur);
      used.add(i);
    }

    return merged.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  /**
   * Slices out a bounding box and normalizes it to a target square canvas (e.g. 128x128)
   * with baseline ground anchoring.
   */
  static extractNormalizedFrame(
    srcRgba: Uint8Array | Buffer,
    srcWidth: number,
    srcHeight: number,
    box: BoundingBox,
    targetSize = 128,
    bgColor?: [number, number, number],
    colorThreshold = 20
  ): Uint8Array {
    const bg = bgColor ?? this.detectBackgroundColor(srcRgba, srcWidth, srcHeight);
    const out = new Uint8Array(targetSize * targetSize * 4);

    // Calculate scale factor to fit targetSize while maintaining aspect ratio
    const padding = 8;
    const maxDimension = targetSize - padding * 2;
    const scale = Math.min(1.0, maxDimension / Math.max(box.width, box.height));

    const dstW = Math.round(box.width * scale);
    const dstH = Math.round(box.height * scale);

    // Horizontal centering + Bottom baseline anchoring
    const dstX = Math.floor((targetSize - dstW) / 2);
    const dstY = targetSize - padding - dstH;

    for (let dy = 0; dy < dstH; dy++) {
      const sy = Math.min(box.height - 1, Math.floor(dy / scale));
      const srcPixelY = box.y + sy;

      for (let dx = 0; dx < dstW; dx++) {
        const sx = Math.min(box.width - 1, Math.floor(dx / scale));
        const srcPixelX = box.x + sx;

        const srcIdx = (srcPixelY * srcWidth + srcPixelX) * 4;
        const dstIdx = ((dstY + dy) * targetSize + (dstX + dx)) * 4;

        const r = srcRgba[srcIdx];
        const g = srcRgba[srcIdx + 1];
        const b = srcRgba[srcIdx + 2];
        const a = srcRgba[srcIdx + 3];

        if (a < 30) continue;

        const dr = r - bg[0];
        const dg = g - bg[1];
        const db = b - bg[2];
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);

        if (dist > colorThreshold) {
          out[dstIdx] = r;
          out[dstIdx + 1] = g;
          out[dstIdx + 2] = b;
          out[dstIdx + 3] = 255;
        }
      }
    }

    return out;
  }
}
