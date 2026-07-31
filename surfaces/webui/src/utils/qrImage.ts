import QRCode from 'qrcode';

const IMAGE_BASE64_PREFIXES = [
  ['iVBOR', 'image/png'],
  ['/9j/', 'image/jpeg'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
] as const;

export async function qrImageSource(
  imageOrScanData: string,
  fallbackScanData = '',
): Promise<string> {
  const candidate = imageOrScanData.trim();
  if (candidate.startsWith('data:image/')) {
    return candidate;
  }

  const encodedImage = IMAGE_BASE64_PREFIXES.find(([prefix]) => candidate.startsWith(prefix));
  if (encodedImage) {
    return `data:${encodedImage[1]};base64,${candidate}`;
  }

  const scanData = candidate || fallbackScanData.trim();
  if (!scanData) {
    return '';
  }

  return QRCode.toDataURL(scanData, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 280,
  });
}
