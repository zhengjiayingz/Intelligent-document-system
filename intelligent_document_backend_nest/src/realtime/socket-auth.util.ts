import type { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '@/auth/types/jwt-payload.type';
import type { PrismaService } from '@/prisma/prisma.service';

export function matchSocketCorsOrigin(
  origin: string | undefined,
  corsOrigin: string | undefined,
): boolean {
  if (!origin) return true;
  if (corsOrigin && origin === corsOrigin) return true;
  return false;
}

export function attachSocketAuthMiddleware(
  server: Server,
  jwtService: JwtService,
  prisma: PrismaService,
): void {
  server.use((socket: Socket, next: (err?: Error) => void) => {
    void (async () => {
      try {
        const token =
          (typeof socket.handshake.auth?.token === 'string' &&
            socket.handshake.auth.token) ||
          (typeof socket.handshake.query?.token === 'string' &&
            socket.handshake.query.token);

        if (!token) {
          next(new Error('未提供认证令牌'));
          return;
        }

        let decoded: JwtPayload;
        try {
          decoded = await jwtService.verifyAsync<JwtPayload>(token);
        } catch {
          next(new Error('无效的认证令牌'));
          return;
        }

        const user = await prisma.user.findUnique({
          where: { id: decoded.id },
          select: {
            id: true,
            status: true,
            mustChangePassword: true,
            sessionVersion: true,
          },
        });

        if (!user || user.status !== 'active') {
          next(new Error('认证无效'));
          return;
        }

        const tokenSv = decoded.sv ?? 0;
        if (tokenSv !== user.sessionVersion) {
          next(new Error('登录会话已失效'));
          return;
        }

        if (user.mustChangePassword) {
          next(new Error('请先修改临时密码后再使用实时通讯'));
          return;
        }

        const data = socket.data as { userId: number };
        data.userId = user.id;
        next();
      } catch {
        next(new Error('无效的认证令牌'));
      }
    })();
  });
}
