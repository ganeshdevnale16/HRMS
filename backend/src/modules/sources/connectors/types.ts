import type { DataSource } from '@prisma/client';

export interface FetchResult { records: Record<string, unknown>[]; cursor?: string | null }
export interface FetchOptions { preview?: boolean }

/** A connector type. New source *types* implement this once; new sources are just configuration rows. */
export interface Connector {
  type: string;
  label: string;
  pull: boolean; // false for push/upload sources (webhook, file, careers page)
  /** True when records already use canonical field names (resume-parsing connectors): no mapping step needed. */
  canonical?: boolean;
  fetch?(source: DataSource, secret: Record<string, string> | null, opts?: FetchOptions): Promise<FetchResult>;
  test?(source: DataSource, secret: Record<string, string> | null): Promise<string>;
}
