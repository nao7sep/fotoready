export type CropFocusPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

export function fitImage(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number
): CropFocusPlacement {
  const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (frameWidth - width) / 2,
    y: (frameHeight - height) / 2,
    width,
    height,
    scale
  };
}

/**
 * Zooms so that max(cropW/frameW, cropH/frameH) equals fillFraction (default 0.5),
 * centering the crop rect. Only called after a commit, never during drag.
 */
export function zoomToCropRect(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  rect: { x: number; y: number; w: number; h: number },
  fillFraction = 0.5
): CropFocusPlacement {
  const fit = fitImage(imageWidth, imageHeight, frameWidth, frameHeight);
  const scaleW = (frameWidth * fillFraction) / Math.max(1, rect.w);
  const scaleH = (frameHeight * fillFraction) / Math.max(1, rect.h);
  const scale = Math.max(fit.scale, Math.min(scaleW, scaleH));
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return {
    x: frameWidth / 2 - cx * scale,
    y: frameHeight / 2 - cy * scale,
    width,
    height,
    scale
  };
}
