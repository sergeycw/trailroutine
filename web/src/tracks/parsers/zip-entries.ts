import { unzipSync } from 'fflate';

// ZIP entries with names in the correct encoding. fflate decodes a name without the UTF-8 flag (bit 11) as Latin-1, but
// Windows archives with Cyrillic names write them in CP866 (as decode866 of the old client). The flag comes from the
// central directory: fflate calls filter in the order of its entries, and the same pass reads the flags.

export interface ZipEntry {
    name: string;
    data: Uint8Array;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const UTF8_FLAG = 0x800;

function centralDirectoryFlags(bytes: Uint8Array): boolean[] | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = bytes.length - 22;
    while (eocd >= 0 && view.getUint32(eocd, true) !== EOCD_SIGNATURE) {
        eocd--;
    }
    if (eocd < 0) {
        return null;
    }
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const flags: boolean[] = [];
    for (let i = 0; i < count && offset + 46 <= bytes.length; i++) {
        if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
            return null;
        }
        flags.push((view.getUint16(offset + 8, true) & UTF8_FLAG) !== 0);
        offset +=
            46 +
            view.getUint16(offset + 28, true) +
            view.getUint16(offset + 30, true) +
            view.getUint16(offset + 32, true);
    }
    return flags;
}

function looksLikeZip(bytes: Uint8Array) {
    return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// null: not a ZIP, or the archive cannot be read (a compression method other than stored/deflate, a truncated file)
export function unzip(bytes: Uint8Array): ZipEntry[] | null {
    if (!looksLikeZip(bytes)) {
        return null;
    }
    const flags = centralDirectoryFlags(bytes);
    const names: string[] = [];
    let files: Record<string, Uint8Array>;
    try {
        files = unzipSync(bytes, {
            filter: (file) => {
                names.push(file.name);
                return true;
            },
        });
    } catch {
        return null;
    }
    return names.map((raw, i) => ({
        // ZIP64 and other archives where the directory was not read: names as fflate gave them
        name: flags && !flags[i] ? new TextDecoder('ibm866').decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))) : raw,
        data: files[raw],
    }));
}
