// ============================================================
// OpenClaw Deploy — Skill Loader
// ============================================================
//
// Loads skill manifests and instruction files from a skills
// directory. Each skill is a subfolder containing:
//   manifest.json  — SkillManifest definition
//   instructions.md — Full instructions template
// ============================================================

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Skill, SkillManifest, ClassificationResult } from '../../types/index.js';
import { matchSkills } from './skill-matcher.js';

export class SkillLoader {
  private skills: Skill[] = [];

  /**
   * Load all skills from the given directory.
   * Each subdirectory should contain manifest.json + instructions.md.
   */
  async loadSkills(skillsDir: string): Promise<void> {
    this.skills = [];
    let entries: string[];
    try {
      const dirEntries = await readdir(skillsDir, { withFileTypes: true });
      entries = dirEntries
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      console.log(`[skills] Skills directory not found: ${skillsDir}`);
      return;
    }

    for (const dir of entries) {
      try {
        const manifestPath = join(skillsDir, dir, 'manifest.json');
        const instructionsPath = join(skillsDir, dir, 'instructions.md');

        const manifestRaw = await readFile(manifestPath, 'utf-8');
        const manifest: SkillManifest = JSON.parse(manifestRaw);

        const instructions = await readFile(instructionsPath, 'utf-8');

        this.skills.push({ manifest, instructions: instructions.trim() });
        console.log(`[skills] Loaded skill: ${manifest.name} (v${manifest.version})`);
      } catch (err) {
        console.warn(`[skills] Failed to load skill from "${dir}":`, err);
      }
    }

    console.log(`[skills] ${this.skills.length} skill(s) loaded`);
  }

  /**
   * Match skills against a user message and classification.
   */
  matchSkills(
    message: string,
    classification: ClassificationResult,
    maxResults: number,
  ): Skill[] {
    return matchSkills(message, classification, this.skills, maxResults);
  }

  /**
   * Get a skill by name.
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.find((s) => s.manifest.name === name);
  }

  /**
   * Get all loaded skills.
   */
  get allSkills(): Skill[] {
    return [...this.skills];
  }
}
