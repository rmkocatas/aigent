// ============================================================
// OpenClaw Deploy — Embedding Codec (float32[] ↔ Buffer)
// ============================================================
// nomic-embed-text produces 768-dim float32 embeddings = 3072 bytes

/** Encode a float32 array into a Buffer for SQLite BLOB storage */
export function encodeEmbedding(embedding: number[]): Buffer {
  const buf = Buffer.alloc(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buf.writeFloatLE(embedding[i], i * 4);
  }
  return buf;
}

/** Decode a Buffer back into a float32 array */
export function decodeEmbedding(buf: Buffer): number[] {
  const len = buf.length / 4;
  const result = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    result[i] = buf.readFloatLE(i * 4);
  }
  return result;
}

/** Cosine similarity between two float arrays */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
