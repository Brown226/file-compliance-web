import Redis from 'ioredis';
import { env } from '../config/env';

class RedisClient {
  private client: Redis;

  constructor() {
    this.client = new Redis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error', err);
    });

    this.client.on('connect', () => {
      console.log('Redis Client Connected');
    });
  }

  async set(key: string, value: any, ttlInSeconds?: number): Promise<void> {
    const stringValue = JSON.stringify(value);
    if (ttlInSeconds) {
      await this.client.set(key, stringValue, 'EX', ttlInSeconds);
    } else {
      await this.client.set(key, stringValue);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch (err) {
      return value as any as T;
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
  
  getClient(): Redis {
    return this.client;
  }
}

export const redisClient = new RedisClient();
