/**
 * TenantExportService — 租户注销导出包（设计 M11 Offboarding）
 *
 * 真实数据：pg_dumpall（租户库 + FastGPT 库）、mongodump（FastGPT 元数据/知识库）、
 * assets 文件字节、租户配置。打包为 tar.gz 后用租户密钥 AES-256-GCM 加密。
 */
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Tenant } from './tenant.entity.js';
import type { TenantService } from './tenant.service.js';
import type { TenantSecretsService } from './tenant-secrets.service.js';
import type { TenantSecretStore } from './tenant-secret-store.js';

export interface ExportRunner {
  dumpPostgres(tenantId: string): Promise<Buffer>;
  dumpMongo(tenantId: string): Promise<Buffer>;
  dumpPostgresTo?(tenantId: string, path: string): Promise<void>;
  dumpMongoTo?(tenantId: string, path: string): Promise<void>;
}

export interface ExportEntry {
  name: string;
  data: Buffer;
}

function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: process.env });
    const chunks: Buffer[] = [];
    const errs: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => errs.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(errs).toString('utf8').slice(-500)}`));
    });
  });
}

/** 生产：控制面容器内通过宿主 docker compose 执行 dump */
export class ShellExportRunner implements ExportRunner {
  constructor(
    private readonly composeRoot: string,
    private readonly secrets: TenantSecretsService,
    private readonly dockerBin = process.env.PLATFORM_DOCKER_BIN ?? 'docker',
  ) {}

  private project(tenantId: string): string {
    return `csbot-t-${tenantId}`;
  }

  private composeFile(tenantId: string): string {
    return join(this.composeRoot, tenantId, 'docker-compose.yml');
  }

  async dumpPostgres(tenantId: string): Promise<Buffer> {
    const bundle = await this.secrets.load(tenantId);
    const password = bundle.POSTGRES_PASSWORD ?? '';
    return run(this.dockerBin, [
      'compose', '-p', this.project(tenantId), '-f', this.composeFile(tenantId),
      'exec', '-T', '-e', `PGPASSWORD=${password}`, 'pg', 'pg_dumpall', '-U', 'cs',
    ]);
  }

  async dumpMongo(tenantId: string): Promise<Buffer> {
    return run(this.dockerBin, [
      'compose', '-p', this.project(tenantId), '-f', this.composeFile(tenantId),
      'exec', '-T', 'mongo', 'mongodump', '--archive', '--gzip',
    ]);
  }

  async dumpPostgresTo(tenantId: string, path: string): Promise<void> {
    const bundle = await this.secrets.load(tenantId);
    const password = bundle.POSTGRES_PASSWORD ?? '';
    await runToFile(this.dockerBin, [
      'compose', '-p', this.project(tenantId), '-f', this.composeFile(tenantId),
      'exec', '-T', '-e', `PGPASSWORD=${password}`, 'pg', 'pg_dumpall', '-U', 'cs',
    ], path);
  }

  async dumpMongoTo(tenantId: string, path: string): Promise<void> {
    await runToFile(this.dockerBin, [
      'compose', '-p', this.project(tenantId), '-f', this.composeFile(tenantId),
      'exec', '-T', 'mongo', 'mongodump', '--archive', '--gzip',
    ], path);
  }
}

function runToFile(cmd: string, args: string[], path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(path, { mode: 0o600 });
    const child = spawn(cmd, args, { env: process.env });
    const errs: Buffer[] = [];
    child.stdout.pipe(out);
    child.stderr.on('data', (c: Buffer) => errs.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) out.end();
      else {
        out.destroy();
        reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(errs).toString('utf8').slice(-500)}`));
      }
    });
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

/** 最小 ustar 打包（仅普通文件；目录由解包器按路径创建） */
export function buildTar(entries: readonly ExportEntry[], mtimeSec = Math.floor(Date.now() / 1000)): Buffer {
  const parts: Buffer[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const name = e.name.replace(/^\/+/, '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (Buffer.byteLength(name) > 99) throw new Error(`tar entry name too long: ${name}`);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write(octal(0o644, 8), 100, 8, 'ascii');
    header.write(octal(0, 8), 108, 8, 'ascii');
    header.write(octal(0, 8), 116, 8, 'ascii');
    header.write(octal(e.data.length, 12), 124, 12, 'ascii');
    header.write(octal(mtimeSec, 12), 136, 12, 'ascii');
    header.write('        ', 148, 8, 'ascii');
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    let sum = 0;
    for (const b of header) sum += b;
    header.write(octal(sum, 7), 148, 7, 'ascii');
    header.write(' ', 155, 1, 'ascii');
    parts.push(header, e.data);
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad > 0) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export class TenantExportService {
  constructor(
    private readonly tenants: TenantService,
    private readonly secrets: TenantSecretsService,
    private readonly store: TenantSecretStore,
    private readonly composeRoot: string,
    private readonly runner: ExportRunner = new ShellExportRunner(composeRoot, secrets),
  ) {}

  /** 汇总导出条目（测试可直接校验内容） */
  async collectEntries(tenantId: string): Promise<ExportEntry[]> {
    const detail = await this.tenants.getDetail(tenantId);
    const tenant: Tenant = detail.tenant;
    const [pg, mongo] = await Promise.all([
      this.runner.dumpPostgres(tenantId),
      this.runner.dumpMongo(tenantId),
    ]);
    const entries: ExportEntry[] = [
      {
        name: 'config.json',
        data: Buffer.from(JSON.stringify({ tenant, exportedAt: new Date().toISOString() }, null, 2)),
      },
      { name: 'pg.sql', data: pg },
      { name: 'mongo.archive.gz', data: mongo },
    ];
    const dataDir = join(this.composeRoot, tenantId, 'data', 'assets');
    await this.walkAssets(dataDir, 'assets', entries);
    const manifest = entries.map((e) => ({
      name: e.name,
      size: e.data.length,
      sha256: createHash('sha256').update(e.data).digest('hex'),
    }));
    entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify({ tenantId, files: manifest }, null, 2)) });
    return entries;
  }

  async export(tenantId: string): Promise<string> {
    const dir = join(this.composeRoot, '..', 'exports', tenantId);
    await fs.mkdir(dir, { recursive: true });
    const work = await fs.mkdtemp(join(dir, '.tmp-'));
    try {
      const pgPath = join(work, 'pg.sql');
      const mongoPath = join(work, 'mongo.archive.gz');
      if (this.runner.dumpPostgresTo) await this.runner.dumpPostgresTo(tenantId, pgPath);
      else await fs.writeFile(pgPath, await this.runner.dumpPostgres(tenantId), { mode: 0o600 });
      if (this.runner.dumpMongoTo) await this.runner.dumpMongoTo(tenantId, mongoPath);
      else await fs.writeFile(mongoPath, await this.runner.dumpMongo(tenantId), { mode: 0o600 });

      const detail = await this.tenants.getDetail(tenantId);
      const configPath = join(work, 'config.json');
      await fs.writeFile(
        configPath,
        JSON.stringify({ tenant: detail.tenant, exportedAt: new Date().toISOString() }, null, 2),
        { mode: 0o600 },
      );

      const assetsRoot = join(this.composeRoot, tenantId, 'data', 'assets');
      const files: Array<{ name: string; path: string }> = [
        { name: 'config.json', path: configPath },
        { name: 'pg.sql', path: pgPath },
        { name: 'mongo.archive.gz', path: mongoPath },
      ];
      await this.walkAssetPaths(assetsRoot, 'assets', files);

      const manifest = [];
      for (const f of files) manifest.push(await hashFile(f.name, f.path));
      const manifestPath = join(work, 'manifest.json');
      await fs.writeFile(
        manifestPath,
        JSON.stringify({ tenantId, files: manifest }, null, 2),
        { mode: 0o600 },
      );

      const out = join(dir, `export-${Date.now()}-${randomUUID().slice(0, 8)}.enc`);
      await packEncrypted([{ name: 'manifest.json', path: manifestPath }, ...files], out, this.store);
      return out;
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async walkAssetPaths(root: string, prefix: string, out: Array<{ name: string; path: string }>): Promise<void> {
    let names: string[] = [];
    try {
      names = await fs.readdir(root);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(root, name);
      const stat = await fs.stat(full);
      if (stat.isDirectory()) await this.walkAssetPaths(full, `${prefix}/${name}`, out);
      else out.push({ name: `${prefix}/${name}`, path: full });
    }
  }

  private async walkAssets(root: string, prefix: string, out: ExportEntry[]): Promise<void> {
    let names: string[] = [];
    try {
      names = await fs.readdir(root);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(root, name);
      const stat = await fs.stat(full);
      if (stat.isDirectory()) await this.walkAssets(full, `${prefix}/${name}`, out);
      else out.push({ name: `${prefix}/${name}`, data: await fs.readFile(full) });
    }
  }
}

interface PackEntry { name: string; path?: string; data?: Buffer; }

function tarHeader(name: string, size: number, mtimeSec = Math.floor(Date.now() / 1000)): Buffer {
  if (Buffer.byteLength(name) > 99) throw new Error(`tar entry name too long: ${name}`);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(octal(0o644, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(size, 12), 124, 12, 'ascii');
  header.write(octal(mtimeSec, 12), 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const b of header) sum += b;
  header.write(octal(sum, 7), 148, 7, 'ascii');
  header.write(' ', 155, 1, 'ascii');
  return header;
}

async function hashFile(name: string, path: string): Promise<{ name: string; size: number; sha256: string }> {
  const hash = createHash('sha256');
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(path);
    rs.on('data', (c) => { size += c.length; hash.update(c); });
    rs.on('end', resolve);
    rs.on('error', reject);
  });
  return { name, size, sha256: hash.digest('hex') };
}

function writeBuffer(stream: NodeJS.WritableStream, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(buf, (err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

function pipeFile(stream: NodeJS.WritableStream, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const rs = createReadStream(path);
    rs.on('data', (chunk) => {
      if (!stream.write(chunk)) {
        rs.pause();
        stream.once('drain', () => rs.resume());
      }
    });
    rs.on('end', resolve);
    rs.on('error', reject);
  });
}

async function packEncrypted(entries: readonly PackEntry[], outPath: string, store: TenantSecretStore): Promise<void> {
  const iv = randomBytes(12);
  const cipher = store.createCipher(iv);
  const out = await fs.open(outPath, 'w', 0o600);
  await out.write(Buffer.concat([iv, Buffer.alloc(16)]));
  await out.close();

  const target = createWriteStream(outPath, { flags: 'r+', start: 28 });
  cipher.pipe(target);
  const gzip = createGzip({ level: 6 });
  gzip.pipe(cipher);

  for (const entry of entries) {
    const name = entry.name.replace(/^\/+/, '');
    const size = entry.data ? entry.data.length : (await fs.stat(entry.path!)).size;
    await writeBuffer(gzip, tarHeader(name, size));
    if (entry.data) await writeBuffer(gzip, entry.data);
    else await pipeFile(gzip, entry.path!);
    const pad = (512 - (size % 512)) % 512;
    if (pad > 0) await writeBuffer(gzip, Buffer.alloc(pad));
  }
  await writeBuffer(gzip, Buffer.alloc(1024));
  gzip.end();
  await once(target, 'finish');
  const tag = cipher.getAuthTag();
  const fh = await fs.open(outPath, 'r+');
  await fh.write(tag, 0, tag.length, 12);
  await fh.close();
}
