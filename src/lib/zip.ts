import JSZip from 'jszip';

export async function makeZip(files: Array<{ path: string; content: string }>) {
  const zip = new JSZip();
  for (const f of files) {
    const p = String(f.path || '').replace(/^\/+/, '');
    zip.file(p || 'file.rpy', f.content);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return blob;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
