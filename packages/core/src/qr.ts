import QRCode from 'qrcode';

/**
 * Error correction level M survives a fingerprint or a bit of glare on a phone
 * screen without inflating the module count the way H does.
 */
const OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 2,
  scale: 8,
} as const;

/** PNG data URL for on-screen display. */
export function qrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { ...OPTIONS, width: 512 });
}

/** SVG string — what you want for printing QR cards. */
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { ...OPTIONS, type: 'svg' });
}
