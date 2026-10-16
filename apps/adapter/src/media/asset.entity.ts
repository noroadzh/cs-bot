/**
 * Asset entity type
 * Represents a media asset stored in the system
 */
export interface Asset {
  id: string;
  type: 'file' | 'link' | 'video';
  name: string;
  url: string | null;
  size: number | null;
  createdAt: Date;
}

export type AssetCreateInput = {
  type: 'file' | 'link' | 'video';
  name: string;
  url?: string;
  size?: number;
  buffer?: Buffer;
};

export type AssetListQuery = {
  limit?: number;
  offset?: number;
};

export type AssetListResult = {
  total: number;
  limit: number;
  offset: number;
  rows: Asset[];
};