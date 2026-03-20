// ============================================================
// OpenClaw Deploy — Knowledge Graph Service
// ============================================================
// Stores and queries relationships between facts. Supports
// 1-2 hop traversals for connected knowledge discovery.
// ============================================================

import { randomUUID } from 'node:crypto';
import type { MemoryDatabase } from './database.js';
import type { RelationshipEntry, RelationType, GraphQuery, GraphEdge, ExtractedRelationship } from './types.js';
import type { MemoryLayer } from '../memory/types.js';

export class KnowledgeGraphService {
  constructor(private readonly memDb: MemoryDatabase) {}

  private get db() { return this.memDb.db; }

  /** Store a single relationship between two existing facts */
  addRelationship(params: {
    userId: string;
    sourceFactId: string;
    targetFactId: string;
    relationType: RelationType;
    confidence?: number;
  }): string {
    const id = randomUUID().slice(0, 8);
    this.db.prepare(`
      INSERT OR IGNORE INTO relationships
        (id, user_id, source_fact_id, target_fact_id, relation_type, confidence, extracted_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id,
      params.userId,
      params.sourceFactId,
      params.targetFactId,
      params.relationType,
      params.confidence ?? 1.0,
      new Date().toISOString(),
    );
    return id;
  }

  /** Match extracted relationships to stored fact IDs and persist them */
  storeRelationships(
    userId: string,
    extractedRels: ExtractedRelationship[],
    factTextToId: Map<string, string>,
  ): number {
    let stored = 0;
    const tx = this.db.transaction(() => {
      for (const rel of extractedRels) {
        const sourceId = factTextToId.get(rel.sourceFact);
        const targetId = factTextToId.get(rel.targetFact);
        if (!sourceId || !targetId || sourceId === targetId) continue;

        this.addRelationship({
          userId,
          sourceFactId: sourceId,
          targetFactId: targetId,
          relationType: rel.relationType,
          confidence: rel.confidence,
        });
        stored++;
      }
    });
    tx();
    return stored;
  }

  /** Query the knowledge graph with optional 1-2 hop traversal */
  query(params: GraphQuery): GraphEdge[] {
    const { userId, factId, relationType, depth = 1, limit = 20 } = params;

    if (factId) {
      // Starting from a specific fact
      const hop1 = this.getDirectEdges(userId, factId, relationType, limit);
      if (depth === 1 || hop1.length === 0) return hop1;

      // 2-hop: traverse to neighbors of neighbors
      const seen = new Set<string>([factId]);
      const hop2: GraphEdge[] = [];
      for (const edge of hop1) {
        seen.add(edge.sourceFact.id);
        seen.add(edge.targetFact.id);
      }
      for (const edge of hop1) {
        const neighborId = edge.sourceFact.id === factId
          ? edge.targetFact.id
          : edge.sourceFact.id;
        const neighborEdges = this.getDirectEdges(userId, neighborId, relationType, 10);
        for (const ne of neighborEdges) {
          if (!seen.has(ne.sourceFact.id) || !seen.has(ne.targetFact.id)) {
            hop2.push(ne);
            seen.add(ne.sourceFact.id);
            seen.add(ne.targetFact.id);
          }
        }
      }
      return [...hop1, ...hop2].slice(0, limit);
    }

    // No factId: return all relationships for user
    let sql = `
      SELECT r.*,
        sf.fact AS source_fact_text, sf.layer AS source_layer,
        tf.fact AS target_fact_text, tf.layer AS target_layer
      FROM relationships r
      JOIN facts sf ON r.source_fact_id = sf.id
      JOIN facts tf ON r.target_fact_id = tf.id
      WHERE r.user_id = ? AND r.is_active = 1 AND sf.is_active = 1 AND tf.is_active = 1
    `;
    const args: any[] = [userId];

    if (relationType) {
      sql += ' AND r.relation_type = ?';
      args.push(relationType);
    }
    sql += ' ORDER BY r.confidence DESC LIMIT ?';
    args.push(limit);

    const rows = this.db.prepare(sql).all(...args) as any[];
    return rows.map((r) => this.rowToEdge(r));
  }

  /** Get direct (1-hop) edges from/to a fact */
  private getDirectEdges(
    userId: string,
    factId: string,
    relationType?: RelationType,
    limit = 20,
  ): GraphEdge[] {
    let sql = `
      SELECT r.*,
        sf.fact AS source_fact_text, sf.layer AS source_layer,
        tf.fact AS target_fact_text, tf.layer AS target_layer
      FROM relationships r
      JOIN facts sf ON r.source_fact_id = sf.id
      JOIN facts tf ON r.target_fact_id = tf.id
      WHERE r.user_id = ? AND r.is_active = 1
        AND sf.is_active = 1 AND tf.is_active = 1
        AND (r.source_fact_id = ? OR r.target_fact_id = ?)
    `;
    const args: any[] = [userId, factId, factId];

    if (relationType) {
      sql += ' AND r.relation_type = ?';
      args.push(relationType);
    }
    sql += ' ORDER BY r.confidence DESC LIMIT ?';
    args.push(limit);

    const rows = this.db.prepare(sql).all(...args) as any[];
    return rows.map((r) => this.rowToEdge(r));
  }

  /** Remove a relationship */
  removeRelationship(relationId: string): boolean {
    const info = this.db.prepare(
      'UPDATE relationships SET is_active = 0 WHERE id = ?',
    ).run(relationId);
    return info.changes > 0;
  }

  /** Deactivate all relationships for a fact (when fact is forgotten) */
  deactivateForFact(factId: string): void {
    this.db.prepare(
      'UPDATE relationships SET is_active = 0 WHERE source_fact_id = ? OR target_fact_id = ?',
    ).run(factId, factId);
  }

  /** Get relationship count for a user */
  getRelationshipCount(userId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS cnt FROM relationships WHERE user_id = ? AND is_active = 1',
    ).get(userId) as { cnt: number };
    return row.cnt;
  }

  private rowToEdge(row: any): GraphEdge {
    return {
      relationId: row.id,
      relationType: row.relation_type as RelationType,
      confidence: row.confidence,
      sourceFact: {
        id: row.source_fact_id,
        fact: row.source_fact_text,
        layer: row.source_layer as MemoryLayer,
      },
      targetFact: {
        id: row.target_fact_id,
        fact: row.target_fact_text,
        layer: row.target_layer as MemoryLayer,
      },
    };
  }
}
