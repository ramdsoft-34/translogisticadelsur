import mongoose from 'mongoose';
import { env } from './config/env.js';

mongoose.set('strictQuery', true);

export async function conectar(uri = env.mongoUri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  return mongoose.connection;
}

export const desconectar = () => mongoose.disconnect();
