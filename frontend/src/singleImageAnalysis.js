export async function inspectSinglePng(file, { x = 0, y = 0, size = 16 } = {}) {
  const bitmap = await createImageBitmap(file);
  try {
    if (![8, 16, 32].includes(size) || x < 0 || y < 0 || x + size > bitmap.width || y + size > bitmap.height) {
      throw new Error(`Choose a region that fits within the ${bitmap.width} × ${bitmap.height} image.`);
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(256, bitmap.width);
    canvas.height = Math.min(256, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const histogram = Object.fromEntries(["red", "green", "blue", "alpha", "grayscale"].map((key) => [key, Array(256).fill(0)]));
    let tileCount = 0;
    for (let y0 = 0; y0 < bitmap.height; y0 += canvas.height) {
      for (let x0 = 0; x0 < bitmap.width; x0 += canvas.width) {
        const width = Math.min(canvas.width, bitmap.width - x0);
        const height = Math.min(canvas.height, bitmap.height - y0);
        context.drawImage(bitmap, x0, y0, width, height, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const alpha = pixels[offset + 3];
          histogram.red[red]++;
          histogram.green[green]++;
          histogram.blue[blue]++;
          histogram.alpha[alpha]++;
          histogram.grayscale[Math.round(0.299 * red + 0.587 * green + 0.114 * blue)]++;
        }
        if (++tileCount % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    const total = bitmap.width * bitmap.height;
    Object.values(histogram).forEach((values) => values.forEach((count, index) => { values[index] = count * 100 / total; }));
    context.drawImage(bitmap, x, y, size, size, 0, 0, size, size);
    const regionPixels = context.getImageData(0, 0, size, size).data;
    const region = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
      const offset = (row * size + column) * 4;
      return Array.from(regionPixels.subarray(offset, offset + 4));
    }));
    return { width: bitmap.width, height: bitmap.height, pixel_count: total, histograms: histogram, region: { x, y, size, pixels: region } };
  } finally {
    bitmap.close();
  }
}
