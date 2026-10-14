import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config.js';
import { prisma } from '../db.js';

/**
 * File storage for resumes.
 * FREE: STORAGE_DRIVER=db stores bytes in Postgres (fine for a few thousand resumes on Neon free).
 * PAID/SCALE: STORAGE_DRIVER=s3 with any S3-compatible bucket — AWS S3, Cloudflare R2 (10 GB free), MinIO,
 * or Azure Blob through an S3 gateway. Switching driver only affects new files; old ones keep working.
 */
let s3: S3Client | null = null;
const client = () => (s3 ??= new S3Client({
  region: env.S3_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY ?? '', secretAccessKey: env.S3_SECRET_KEY ?? '' },
}));

export async function saveFile(name: string, mime: string, data: Buffer) {
  if (env.STORAGE_DRIVER === 's3') {
    const row = await prisma.storedFile.create({ data: { name, mime, size: data.length, driver: 's3' } });
    const key = `resumes/${row.id}/${name.replace(/[^\w.\-]+/g, '_')}`;
    await client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: data, ContentType: mime }));
    await prisma.storedFile.update({ where: { id: row.id }, data: { key } });
    return row.id;
  }
  const row = await prisma.storedFile.create({ data: { name, mime, size: data.length, driver: 'db', data } });
  return row.id;
}

export async function readFile(id: string) {
  const f = await prisma.storedFile.findUniqueOrThrow({ where: { id } });
  if (f.driver === 's3') {
    const r = await client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: f.key! }));
    return { name: f.name, mime: f.mime, data: Buffer.from(await r.Body!.transformToByteArray()) };
  }
  return { name: f.name, mime: f.mime, data: Buffer.from(f.data!) };
}

export async function deleteFile(id?: string | null) {
  if (!id) return;
  const f = await prisma.storedFile.findUnique({ where: { id } });
  if (!f) return;
  if (f.driver === 's3' && f.key) await client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: f.key })).catch(() => undefined);
  await prisma.storedFile.delete({ where: { id } });
}
