/**
 * Asset Reference Resolver
 * Parses and resolves asset references in answer text
 */
import { Injectable } from '@nestjs/common';
import { AssetService } from './asset.service.js';
import type { Asset } from './asset.entity.js';

const ASSET_REF_PATTERN = /\[\[素材:([a-f0-9-]+)\]\]/gi;

@Injectable()
export class AssetReferenceResolver {
  constructor(private readonly assetService: AssetService) {}

  /**
   * Extract all asset references from text
   * Returns array of unique asset IDs
   */
  parseReferences(text: string): string[] {
    const matches = text.matchAll(ASSET_REF_PATTERN);
    const ids = new Set<string>();
    for (const match of matches) {
      ids.add(match[1]);
    }
    return Array.from(ids);
  }

  /**
   * Resolve an asset reference ID to actual Asset
   */
  async resolveReference(id: string): Promise<Asset | null> {
    return this.assetService.findById(id);
  }

  /**
   * Resolve all references in text, cap at maxReferences
   * Returns resolved assets in order of first appearance
   */
  async resolveAll(text: string, maxReferences = 2): Promise<Asset[]> {
    const ids = this.parseReferences(text).slice(0, maxReferences);
    const assets: Asset[] = [];

    for (const id of ids) {
      const asset = await this.resolveReference(id);
      if (asset) {
        assets.push(asset);
      }
    }

    return assets;
  }

  /**
   * Check if text contains any asset references
   */
  hasReferences(text: string): boolean {
    ASSET_REF_PATTERN.lastIndex = 0;
    return ASSET_REF_PATTERN.test(text);
  }
}