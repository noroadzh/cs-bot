/**
 * Asset Service
 * Handles CRUD operations for media assets
 */
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import type { Asset, AssetCreateInput, AssetListQuery, AssetListResult } from './asset.entity.js';

const MAX_ASSET_BYTES = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm',
  'application/pdf',
];

const DATA_DIR = join(process.cwd(), 'data', 'assets');

@Injectable()
export class AssetService {
  private readonly logger = new AppLogger('AssetService');
  private readonly pool: Pool;

  constructor(_config: ConfigService) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
    // Ensure data directory exists
    this.ensureDataDir();
  }

  private async ensureDataDir(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (err) {
      this.logger.error({ detail: 'mkdir-fail', err: (err as Error).message });
    }
  }

  /**
   * Create asset from uploaded file buffer
   */
  async createFromFile(buffer: Buffer, originalName: string, mimeType: string): Promise<Asset> {
    // 2.4 超限 → 413 Payload Too Large（裸 Error 会被 Nest 翻成 500，语义错误）
    if (buffer.length > MAX_ASSET_BYTES) {
      throw new HttpException(
        {
          errCode: 'ASSET_TOO_LARGE',
          detail: `file exceeds max size of ${MAX_ASSET_BYTES} bytes`,
          maxBytes: MAX_ASSET_BYTES,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // 2.5 MIME 不在白名单 → 415 Unsupported Media Type
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new HttpException(
        {
          errCode: 'UNSUPPORTED_MEDIA_TYPE',
          detail: `unsupported MIME type: ${mimeType}`,
          allowed: ALLOWED_MIME_TYPES,
        },
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    const id = randomUUID();
    const ext = this.getExtension(mimeType);
    const storedName = `${id}${ext}`;
    const filePath = join(DATA_DIR, storedName);

    // Write file
    await fs.writeFile(filePath, buffer);

    // Insert record
    const result = await this.pool.query(
      `INSERT INTO asset (id, type, name, url, size, created_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id, type, name, url, size, created_at`,
      [id, 'file', originalName, `/assets/${storedName}`, buffer.length],
    );

    return this.mapRowToAsset(result.rows[0]);
  }

  /**
   * Create asset from external URL
   */
  async createFromLink(url: string, name: string): Promise<Asset> {
    const id = randomUUID();

    const result = await this.pool.query(
      `INSERT INTO asset (id, type, name, url, size, created_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id, type, name, url, size, created_at`,
      [id, 'link', name, url, null],
    );

    return this.mapRowToAsset(result.rows[0]);
  }

  /**
   * Find asset by ID
   */
  async findById(id: string): Promise<Asset | null> {
    const result = await this.pool.query(
      'SELECT id, type, name, url, size, created_at FROM asset WHERE id = $1',
      [id],
    );
    return result.rows[0] ? this.mapRowToAsset(result.rows[0]) : null;
  }

  /**
   * List assets with pagination
   */
  async findAll(query: AssetListQuery = {}): Promise<AssetListResult> {
    const limit = Math.min(query.limit ?? 50, 100);
    const offset = query.offset ?? 0;

    const countResult = await this.pool.query('SELECT COUNT(*) as total FROM asset');
    const total = parseInt(countResult.rows[0].total, 10);

    const result = await this.pool.query(
      'SELECT id, type, name, url, size, created_at FROM asset ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset],
    );

    return {
      total,
      limit,
      offset,
      rows: result.rows.map(row => this.mapRowToAsset(row)),
    };
  }

  /**
   * Delete asset by ID
   */
  async delete(id: string): Promise<boolean> {
    const asset = await this.findById(id);
    if (!asset) return false;

    // Delete file if it's a file type
    if (asset.type === 'file' && asset.url) {
      const fileName = asset.url.split('/').pop();
      if (fileName) {
        try {
          await fs.unlink(join(DATA_DIR, fileName));
        } catch {
          // File may not exist, ignore
        }
      }
    }

    await this.pool.query('DELETE FROM asset WHERE id = $1', [id]);
    return true;
  }

  /**
   * Resolve file path for asset
   */
  resolvePath(id: string): string {
    return join(DATA_DIR, id);
  }

  /**
   * Check if MIME type is supported
   */
  isSupportedMediaType(mimeType: string): boolean {
    return ALLOWED_MIME_TYPES.includes(mimeType);
  }

  private getExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'application/pdf': '.pdf',
    };
    return map[mimeType] || '';
  }

  private mapRowToAsset(row: Record<string, unknown>): Asset {
    return {
      id: row.id as string,
      type: row.type as Asset['type'],
      name: row.name as string,
      url: row.url as string | null,
      size: row.size as number | null,
      createdAt: row.created_at as Date,
    };
  }
}