export const WATERMARK_TEXT_PADDING_X_EM = 0.45;
export const WATERMARK_TEXT_PADDING_Y_EM = 0.32;
export const WATERMARK_TEXT_LINE_HEIGHT_EM = 1.25;
export const WATERMARK_TEXT_BOX_HEIGHT_EM = WATERMARK_TEXT_LINE_HEIGHT_EM + WATERMARK_TEXT_PADDING_Y_EM * 2;

export function estimateWatermarkTextLayout(
  text: string,
  fontSize: number,
  bold: boolean,
  italic: boolean
): { width: number; height: number; paddingX: number; baselineY: number } {
  const characterCount = Math.max(1, Array.from(text).length);
  const characterWidthEm = 0.62 + (bold ? 0.04 : 0) + (italic ? 0.04 : 0);
  const paddingX = Math.ceil(fontSize * WATERMARK_TEXT_PADDING_X_EM);
  const width = Math.ceil(Math.max(
    fontSize * 2,
    characterCount * fontSize * characterWidthEm + paddingX * 2
  ));
  const height = Math.ceil(fontSize * WATERMARK_TEXT_BOX_HEIGHT_EM);
  const baselineY = Math.ceil(fontSize * (WATERMARK_TEXT_PADDING_Y_EM + 0.92));
  return { width, height, paddingX, baselineY };
}
