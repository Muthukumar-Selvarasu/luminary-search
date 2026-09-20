import { GridFSBucket } from 'mongodb';
import { db } from '../db.js';

let bucket: GridFSBucket | null = null;

export async function getGridFSBucket(): Promise<GridFSBucket> {
  if (!bucket) {
    const database = await db();
    bucket = new GridFSBucket(database, { bucketName: 'uploads' });
  }
  return bucket;
}
