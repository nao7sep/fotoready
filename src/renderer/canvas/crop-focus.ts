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
