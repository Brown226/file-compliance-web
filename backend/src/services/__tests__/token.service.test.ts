import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenService } from '../auth/token.service';

// Mock dependencies
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(() => 'mock-token'),
    verify: vi.fn(() => ({ id: '1', username: 'test', role: 'user', departmentId: null })),
  },
}));

vi.mock('../../config/env', () => ({
  env: {
    jwtSecret: 'test-secret',
    jwtExpiresIn: '24h',
  },
}));

vi.mock('../../utils/redis', () => ({
  redisClient: {
    set: vi.fn(),
    get: vi.fn(),
  },
}));

import jwt from 'jsonwebtoken';
import { redisClient } from '../../utils/redis';

describe('TokenService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  });

  describe('generateToken', () => {
    it('should generate a JWT token', () => {
      const payload = { id: '1', username: 'test', role: 'user', departmentId: null };
      const token = TokenService.generateToken(payload);

      expect(token).toBe('mock-token');
      expect(jwt.sign).toHaveBeenCalledWith(payload, 'test-secret', { expiresIn: '24h' });
    });

    it('should pass through all payload fields', () => {
      const payload = { id: '2', username: 'admin', role: 'admin', departmentId: 'dept-1' };
      TokenService.generateToken(payload);

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining(payload),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('verifyToken', () => {
    it('should verify and decode a valid token', () => {
      const result = TokenService.verifyToken('valid-token');

      expect(result).toEqual({
        id: '1',
        username: 'test',
        role: 'user',
        departmentId: null,
      });
      expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
    });
  });

  describe('blacklistToken', () => {
    it('should add token to blacklist in Redis', async () => {
      (redisClient.set as any).mockResolvedValue('OK');

      await TokenService.blacklistToken('test-token', 3600);

      expect(redisClient.set).toHaveBeenCalledWith('blacklist:test-token', 'true', 3600);
    });
  });

  describe('isTokenBlacklisted', () => {
    it('should return true for blacklisted token', async () => {
      (redisClient.get as any).mockResolvedValue('true');

      const result = await TokenService.isTokenBlacklisted('test-token');
      expect(result).toBe(true);
    });

    it('should return false for non-blacklisted token', async () => {
      (redisClient.get as any).mockResolvedValue(null);

      const result = await TokenService.isTokenBlacklisted('test-token');
      expect(result).toBe(false);
    });

    it('should return false for other values', async () => {
      (redisClient.get as any).mockResolvedValue('false');

      const result = await TokenService.isTokenBlacklisted('test-token');
      expect(result).toBe(false);
    });
  });
});
