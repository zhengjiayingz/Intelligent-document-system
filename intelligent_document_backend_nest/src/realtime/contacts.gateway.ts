import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { RealtimeEmitterService } from './realtime-emitter.service';
import {
  attachSocketAuthMiddleware,
  matchSocketCorsOrigin,
} from './socket-auth.util';

@WebSocketGateway({
  path: '/socket.io',
  cors: {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, ok?: boolean) => void,
    ) => {
      const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
      if (matchSocketCorsOrigin(origin, corsOrigin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  },
})
export class ContactsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(ContactsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly emitter: RealtimeEmitterService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  afterInit(server: Server): void {
    this.emitter.attach(server);
    attachSocketAuthMiddleware(server, this.jwtService, this.prisma);
    void this.attachRedisAdapter(server);
  }

  handleConnection(client: Socket): void {
    const data = client.data as { userId: number };
    const uid = data.userId;
    void client.join(`user:${uid}`);
  }

  private async attachRedisAdapter(server: Server): Promise<void> {
    const redis = this.redisService.getClient();
    if (!redis) {
      this.logger.warn('socket redis unavailable, single-process mode only');
      return;
    }
    try {
      const subClient = redis.duplicate();
      await subClient.connect();
      server.adapter(createAdapter(redis, subClient));
      this.logger.log('socket redis adapter enabled');
    } catch (err) {
      this.logger.warn(
        `socket redis adapter failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
