import mongoose from 'mongoose';

import { config } from '../config';
import { logger } from '../logger';

/** Reuses the existing MongoDB infrastructure (same instance as the CRM). */
export async function connectDb(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info({ db: mongoose.connection.name }, 'mongodb connected');
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
