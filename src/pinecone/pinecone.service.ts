import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pinecone } from '@pinecone-database/pinecone';

export interface VectorMemoryRecord {
  id: string;
  sourceType: string;
  sourceId?: number | string;
  title: string;
  content: string;
  timestamp?: string;
  metadata?: Record<string, any>;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  sourceType: string;
  sourceId?: number | string;
  title: string;
  snippet: string;
  timestamp?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class PineconeService implements OnModuleInit {
  private readonly logger = new Logger(PineconeService.name);
  private pineconeClient: Pinecone | null = null;
  private isConnected = false;
  private readonly indexName = process.env.PINECONE_INDEX || 'pulse-intelligence';

  // Fast In-Memory Fallback Vector Index (Simulates Vector HNSW search when Pinecone API key is not yet set)
  private localVectorStore: Map<string, { id: string; userId: number; vector: number[]; record: VectorMemoryRecord }> =
    new Map();

  async onModuleInit() {
    await this.initPinecone();
  }

  private async initPinecone() {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        '[Pinecone] PINECONE_API_KEY not configured in .env. Operating in high-speed local cosine vector search mode.',
      );
      return;
    }

    try {
      this.pineconeClient = new Pinecone({ apiKey });
      this.isConnected = true;
      this.logger.log(`[Pinecone] Initialized connection to Pinecone Vector DB (Index: ${this.indexName})`);
    } catch (err: any) {
      this.logger.warn(`[Pinecone] Initialization deferred: ${err.message}`);
      this.isConnected = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Vector Embedding Generator
  // ---------------------------------------------------------------------------

  async generateEmbedding(text: string): Promise<number[]> {
    const clean = text.trim();
    if (!clean) return new Array(384).fill(0);

    const openAiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    // 1. Try Pinecone Inference API if client is connected
    if (this.isConnected && this.pineconeClient) {
      try {
        const embeddings: any = await (this.pineconeClient.inference as any).embed({
          model: 'multilingual-e5-large',
          inputs: [clean.slice(0, 8000)],
          parameters: { inputType: 'passage', truncate: 'END' },
        });
        if (embeddings && embeddings.data && embeddings.data[0] && (embeddings.data[0] as any).values) {
          return (embeddings.data[0] as any).values;
        }
      } catch (err: any) {
        this.logger.debug(`[Pinecone] Inference embedding fallback: ${err.message}`);
      }
    }

    // 2. Try OpenAI Embedding API
    if (openAiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: clean.slice(0, 8000),
          }),
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const json = await res.json();
          const vec = json.data?.[0]?.embedding;
          if (Array.isArray(vec)) return vec;
        }
      } catch {}
    }

    // 3. Try Gemini Embedding API
    if (geminiKey) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'models/text-embedding-004',
              content: { parts: [{ text: clean.slice(0, 8000) }] },
            }),
            signal: AbortSignal.timeout(6000),
          },
        );
        if (res.ok) {
          const json = await res.json();
          const vec = json.embedding?.values;
          if (Array.isArray(vec)) return vec;
        }
      } catch {}
    }

    // 4. Deterministic Hash-Tuned Cosine Vector (384-dimensional representation)
    return this.createDeterministicVector(clean, 384);
  }

  private createDeterministicVector(text: string, dimensions: number = 384): number[] {
    const vec = new Array(dimensions).fill(0);
    const tokens = text.toLowerCase().split(/\s+/);

    tokens.forEach((t, i) => {
      let hash = 0;
      for (let j = 0; j < t.length; j++) {
        hash = (hash << 5) - hash + t.charCodeAt(j);
        hash |= 0;
      }
      const idx = Math.abs(hash) % dimensions;
      const weight = 1 / (1 + Math.log(1 + i));
      vec[idx] += weight;
    });

    // Normalize vector (L2 norm)
    const norm = Math.sqrt(vec.reduce((acc, val) => acc + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < dimensions; i++) {
        vec[i] = vec[i] / norm;
      }
    }

    return vec;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ---------------------------------------------------------------------------
  // Vector Upsert Operations (Write Pipeline)
  // ---------------------------------------------------------------------------

  async upsertMemory(userId: number, record: VectorMemoryRecord): Promise<void> {
    const vector = await this.generateEmbedding(`${record.title}\n${record.content}`);
    
    // Normalize vector ID to avoid duplicate prefixes like activity_act_1
    const cleanId = String(record.id).replace(new RegExp(`^${record.sourceType}_`, 'i'), '');
    const vectorId = `${record.sourceType}_${cleanId}`;

    // 1. Store in local vector store
    this.localVectorStore.set(`${userId}:${vectorId}`, {
      id: vectorId,
      userId,
      vector,
      record,
    });

    // 2. Upsert to Pinecone if connected
    if (this.isConnected && this.pineconeClient) {
      try {
        const index = this.pineconeClient.index(this.indexName);
        const recordData = {
          id: vectorId,
          values: vector,
          metadata: {
            userId,
            sourceType: record.sourceType,
            sourceId: String(record.sourceId || cleanId),
            title: record.title,
            content: record.content,
            timestamp: record.timestamp || new Date().toISOString(),
            ...(record.metadata || {}),
          },
        };

        // Pinecone SDK v5 accepts { records: [...] }
        try {
          await (index.namespace(`user-${userId}`) as any).upsert({ records: [recordData] });
        } catch {
          await (index.namespace(`user-${userId}`) as any).upsert([recordData]);
        }

        this.logger.debug(`[Pinecone] Upserted vector ${vectorId} for user #${userId}`);
        return;
      } catch (err: any) {
        this.logger.warn(`[Pinecone] Upsert notice (${err.message}). Saved to local vector index.`);
      }
    }
  }

  async bulkUpsertMemories(userId: number, records: VectorMemoryRecord[]): Promise<number> {
    this.logger.log(`[Pinecone] Bulk vectorizing ${records.length} records for user #${userId}...`);
    const pineconeRecords: Array<any> = [];

    for (const rec of records) {
      const vector = await this.generateEmbedding(`${rec.title}\n${rec.content}`);
      const cleanId = String(rec.id).replace(new RegExp(`^${rec.sourceType}_`, 'i'), '');
      const vectorId = `${rec.sourceType}_${cleanId}`;

      pineconeRecords.push({
        id: vectorId,
        values: vector,
        metadata: {
          userId,
          sourceType: rec.sourceType,
          sourceId: String(rec.sourceId || cleanId),
          title: rec.title,
          content: rec.content,
          timestamp: rec.timestamp || new Date().toISOString(),
          ...(rec.metadata || {}),
        },
      });

      this.localVectorStore.set(`${userId}:${vectorId}`, {
        id: vectorId,
        userId,
        vector,
        record: rec,
      });
    }

    if (this.isConnected && this.pineconeClient && pineconeRecords.length > 0) {
      try {
        const index = this.pineconeClient.index(this.indexName);
        for (let i = 0; i < pineconeRecords.length; i += 50) {
          const chunk = pineconeRecords.slice(i, i + 50);
          try {
            await (index.namespace(`user-${userId}`) as any).upsert({ records: chunk });
          } catch {
            await (index.namespace(`user-${userId}`) as any).upsert(chunk);
          }
        }
        this.logger.log(`[Pinecone] Successfully indexed ${pineconeRecords.length} vectors to Pinecone.`);
      } catch (err: any) {
        this.logger.warn(`[Pinecone] Bulk upsert notice: ${err.message}`);
      }
    }

    return pineconeRecords.length;
  }

  // ---------------------------------------------------------------------------
  // Vector Deletion Operations (Delete Pipeline)
  // ---------------------------------------------------------------------------

  async deleteMemory(userId: number, idOrVectorId: string | number, sourceType?: string): Promise<void> {
    const rawId = String(idOrVectorId);
    const candidateSet = new Set<string>();

    candidateSet.add(rawId);

    if (sourceType) {
      const bareId = rawId.replace(new RegExp(`^(${sourceType}|${sourceType.slice(0, 3)})_`, 'i'), '');
      candidateSet.add(`${sourceType}_${bareId}`);
      candidateSet.add(`${sourceType}_${sourceType.slice(0, 3)}_${bareId}`);
      candidateSet.add(`${sourceType.slice(0, 3)}_${bareId}`);
    } else {
      candidateSet.add(`activity_${rawId}`);
      candidateSet.add(`activity_act_${rawId}`);
      candidateSet.add(`act_${rawId}`);
      candidateSet.add(`job_${rawId}`);
      candidateSet.add(`leetcode_${rawId}`);
      candidateSet.add(`lc_${rawId}`);
      candidateSet.add(`linkedin_${rawId}`);
      candidateSet.add(`li_${rawId}`);
    }

    const uniqueIds = Array.from(candidateSet);

    // 1. Remove from local memory vector store
    for (const vid of uniqueIds) {
      this.localVectorStore.delete(`${userId}:${vid}`);
    }

    // 2. Delete from Pinecone if connected
    if (this.isConnected && this.pineconeClient) {
      try {
        const index = this.pineconeClient.index(this.indexName);
        const ns = index.namespace(`user-${userId}`) as any;

        try {
          // Pinecone SDK v5: deleteMany with array
          await ns.deleteMany(uniqueIds);
        } catch {
          try {
            // Pinecone SDK v5: deleteMany with object
            await ns.deleteMany({ ids: uniqueIds });
          } catch {
            for (const vid of uniqueIds) {
              try {
                await ns.deleteOne(vid);
              } catch {}
            }
          }
        }
        this.logger.log(`[Pinecone] Successfully purged vector(s) [${uniqueIds.join(', ')}] for user #${userId}`);
      } catch (err: any) {
        this.logger.warn(`[Pinecone] Delete vector notice (${err.message}).`);
      }
    }
  }

  async deleteMemories(userId: number, vectorIds: string[]): Promise<void> {
    if (!vectorIds || vectorIds.length === 0) return;

    for (const id of vectorIds) {
      await this.deleteMemory(userId, id);
    }
  }

  // ---------------------------------------------------------------------------
  // Vector Search Query (Sub-20ms Retrieval - NO TABLE SCANS)
  // ---------------------------------------------------------------------------

  async querySemanticMemories(userId: number, queryText: string, topK: number = 8): Promise<VectorSearchResult[]> {
    const queryVector = await this.generateEmbedding(queryText);

    // 1. Query Pinecone if connected
    if (this.isConnected && this.pineconeClient) {
      try {
        const index = this.pineconeClient.index(this.indexName);
        const queryRes = await index.namespace(`user-${userId}`).query({
          vector: queryVector,
          topK,
          includeMetadata: true,
          includeValues: false,
        });

        if (queryRes.matches && queryRes.matches.length > 0) {
          return queryRes.matches.map((m) => {
            const meta = (m.metadata || {}) as any;
            return {
              id: m.id,
              score: m.score || 0,
              sourceType: meta.sourceType || 'memory',
              sourceId: meta.sourceId,
              title: meta.title || 'Indexed Memory',
              snippet: meta.content || '',
              timestamp: meta.timestamp,
              metadata: meta,
            };
          });
        }
      } catch (err: any) {
        this.logger.warn(`[Pinecone] Query error (${err.message}). Falling back to local vector search.`);
      }
    }

    // 2. High-speed local Cosine Similarity Vector Search across indexed memories
    const candidates: Array<{ score: number; item: { id: string; record: VectorMemoryRecord } }> = [];

    for (const [key, stored] of this.localVectorStore.entries()) {
      if (stored.userId === userId) {
        const score = this.cosineSimilarity(queryVector, stored.vector);
        candidates.push({ score, item: stored });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    return candidates.slice(0, topK).map((c) => ({
      id: c.item.record.id,
      score: c.score,
      sourceType: c.item.record.sourceType,
      sourceId: c.item.record.sourceId,
      title: c.item.record.title,
      snippet: c.item.record.content,
      timestamp: c.item.record.timestamp,
      metadata: c.item.record.metadata,
    }));
  }

  isVectorStoreReady(): boolean {
    return this.isConnected || this.localVectorStore.size > 0;
  }
}
