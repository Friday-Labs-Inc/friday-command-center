// Client-side Ed25519 signing via Web Crypto. The operator's private key is imported
// here and never leaves the browser — only the signature is returned.

function hexToBytes(hex: string): Uint8Array {
  const a = new Uint8Array(hex.length / 2)
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16)
  return a
}

function bytesToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export async function importEd25519Private(hex: string): Promise<CryptoKey> {
  // Wrap the 32-byte raw seed in the fixed Ed25519 PKCS#8 prefix.
  const pkcs8 = new Uint8Array(48)
  pkcs8.set(hexToBytes('302e020100300506032b657004220420'), 0)
  pkcs8.set(hexToBytes(hex), 16)
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' } as any, false, ['sign'])
}

export async function signHex(key: CryptoKey, dataHex: string): Promise<string> {
  const sig = await crypto.subtle.sign({ name: 'Ed25519' } as any, key, hexToBytes(dataHex))
  return bytesToHex(sig)
}
