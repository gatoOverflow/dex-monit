import { UnauthorizedException } from '@nestjs/common';
import { AuthService, JwtPayload } from './auth.service';

// Mock implementations
const mockUsersService = {
  findByEmail: jest.fn(),
  findByIdOrThrow: jest.fn(),
  validatePassword: jest.fn(),
  create: jest.fn(),
  updateLastLogin: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn(),
  verify: jest.fn(),
};

const mockPrismaService = {
  session: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashed-password',
    role: 'MEMBER',
    isActive: true,
    avatarUrl: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSession = {
    id: 'session-123',
    userId: 'user-123',
    token: 'jwt-token',
    refreshToken: 'refresh-token',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    userAgent: 'test-agent',
    ipAddress: '127.0.0.1',
    createdAt: new Date(),
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create service instance with mocks
    service = new AuthService(
      mockUsersService as any,
      mockJwtService as any,
      mockPrismaService as any,
      mockLogger as any,
    );
  });

  describe('validateUser', () => {
    it('should return user without password when credentials are valid', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockUsersService.validatePassword.mockResolvedValue(true);

      const result = await service.validateUser('test@example.com', 'password');

      expect(result).toBeDefined();
      expect(result?.email).toBe('test@example.com');
      expect(result).not.toHaveProperty('passwordHash');
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith('test@example.com');
    });

    it('should return null when user not found', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      const result = await service.validateUser('notfound@example.com', 'password');

      expect(result).toBeNull();
    });

    it('should return null when user is inactive', async () => {
      mockUsersService.findByEmail.mockResolvedValue({ ...mockUser, isActive: false });

      const result = await service.validateUser('test@example.com', 'password');

      expect(result).toBeNull();
    });

    it('should return null when password is invalid', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockUsersService.validatePassword.mockResolvedValue(false);

      const result = await service.validateUser('test@example.com', 'wrong-password');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    const userWithoutPassword = {
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      role: 'MEMBER',
      isActive: true,
      avatarUrl: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should create session and return tokens', async () => {
      mockJwtService.sign.mockReturnValue('jwt-token');
      mockPrismaService.session.create.mockResolvedValue(mockSession);
      mockUsersService.updateLastLogin.mockResolvedValue(undefined);

      const result = await service.login(userWithoutPassword, 'test-agent', '127.0.0.1');

      expect(result.accessToken).toBe('jwt-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBe(7 * 24 * 60 * 60);
      expect(result.user.email).toBe('test@example.com');
      expect(mockPrismaService.session.create).toHaveBeenCalled();
      expect(mockUsersService.updateLastLogin).toHaveBeenCalledWith('user-123');
    });

    it('should sign JWT with correct payload', async () => {
      mockJwtService.sign.mockReturnValue('jwt-token');
      mockPrismaService.session.create.mockResolvedValue(mockSession);

      await service.login(userWithoutPassword);

      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: 'user-123',
        email: 'test@example.com',
        role: 'MEMBER',
      });
    });
  });

  describe('register', () => {
    it('should create user and return tokens', async () => {
      const registerDto = {
        email: 'new@example.com',
        password: 'password123',
        name: 'New User',
      };

      const newUser = {
        id: 'new-user-123',
        email: 'new@example.com',
        name: 'New User',
        role: 'MEMBER',
        isActive: true,
        avatarUrl: null,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.create.mockResolvedValue(newUser);
      mockJwtService.sign.mockReturnValue('jwt-token');
      mockPrismaService.session.create.mockResolvedValue(mockSession);

      const result = await service.register(registerDto);

      expect(result.accessToken).toBeDefined();
      expect(result.user.email).toBe('new@example.com');
      expect(mockUsersService.create).toHaveBeenCalledWith(registerDto);
    });
  });

  describe('refreshTokens', () => {
    it('should refresh tokens when refresh token is valid', async () => {
      mockPrismaService.session.findUnique.mockResolvedValue(mockSession);
      mockUsersService.findByIdOrThrow.mockResolvedValue(mockUser);
      mockPrismaService.session.delete.mockResolvedValue(mockSession);
      mockJwtService.sign.mockReturnValue('new-jwt-token');
      mockPrismaService.session.create.mockResolvedValue({
        ...mockSession,
        token: 'new-jwt-token',
      });

      const result = await service.refreshTokens('refresh-token');

      expect(result.accessToken).toBe('new-jwt-token');
      expect(mockPrismaService.session.delete).toHaveBeenCalledWith({
        where: { id: 'session-123' },
      });
    });

    it('should throw UnauthorizedException when refresh token not found', async () => {
      mockPrismaService.session.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens('invalid-token')).rejects.toThrow(
        UnauthorizedException
      );
    });

    it('should throw UnauthorizedException when session is expired', async () => {
      mockPrismaService.session.findUnique.mockResolvedValue({
        ...mockSession,
        expiresAt: new Date(Date.now() - 1000), // Expired
      });

      await expect(service.refreshTokens('refresh-token')).rejects.toThrow(
        UnauthorizedException
      );
    });
  });

  describe('logout', () => {
    it('should delete session by token', async () => {
      mockPrismaService.session.deleteMany.mockResolvedValue({ count: 1 });

      await service.logout('jwt-token');

      expect(mockPrismaService.session.deleteMany).toHaveBeenCalledWith({
        where: { token: 'jwt-token' },
      });
    });
  });

  describe('logoutAll', () => {
    it('should delete all sessions for user', async () => {
      mockPrismaService.session.deleteMany.mockResolvedValue({ count: 3 });

      await service.logoutAll('user-123');

      expect(mockPrismaService.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
    });
  });

  describe('validateToken', () => {
    it('should return payload when token is valid and session exists', async () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        role: 'MEMBER',
      };

      mockJwtService.verify.mockReturnValue(payload);
      mockPrismaService.session.findUnique.mockResolvedValue(mockSession);

      const result = await service.validateToken('jwt-token');

      expect(result).toEqual(payload);
    });

    it('should return null when session not found', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-123',
        email: 'test@example.com',
        role: 'MEMBER',
      });
      mockPrismaService.session.findUnique.mockResolvedValue(null);

      const result = await service.validateToken('jwt-token');

      expect(result).toBeNull();
    });

    it('should return null when session is expired', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-123',
        email: 'test@example.com',
        role: 'MEMBER',
      });
      mockPrismaService.session.findUnique.mockResolvedValue({
        ...mockSession,
        expiresAt: new Date(Date.now() - 1000),
      });

      const result = await service.validateToken('jwt-token');

      expect(result).toBeNull();
    });

    it('should return null when JWT verification fails', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const result = await service.validateToken('invalid-token');

      expect(result).toBeNull();
    });
  });
});
