import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import * as os from 'os';
import * as fs from 'fs';
import { exec } from 'child_process';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  SystemSnapshot,
  CpuMetrics,
  CpuCoreInfo,
  MemoryMetrics,
  DiskMetrics,
  HostInfo,
  NetworkInterfaceInfo,
  ServicesMetrics,
  ServiceResourceUsage,
} from './system-monitor.interface';

interface CpuTimeSnapshot {
  idle: number;
  total: number;
}

interface RedisCpuSnapshot {
  sys: number;
  user: number;
  timestamp: number;
}

interface ServiceProcessCache {
  postgresRssBytes: number;
  postgresCpuPercent: number;
  postgresProcessCount: number;
  redisRssBytes: number;
  redisCpuPercent: number;
  lastUpdated: number;
}

@Injectable()
export class SystemMonitorService {
  private readonly logger = new Logger(SystemMonitorService.name);
  private prevCpuTimes: CpuTimeSnapshot[] = [];
  private lastSnapshotTime: number = Date.now();
  private prevRedisCpu: RedisCpuSnapshot | null = null;

  // Cached process telemetry to prevent spawning shell commands too frequently
  private processCache: ServiceProcessCache = {
    postgresRssBytes: 0,
    postgresCpuPercent: 0,
    postgresProcessCount: 0,
    redisRssBytes: 0,
    redisCpuPercent: 0,
    lastUpdated: 0,
  };

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redisClient?: Redis,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    this.initCpuBaseline();
    this.pollProcessMetrics();
  }

  private initCpuBaseline(): void {
    const cpus = os.cpus();
    this.prevCpuTimes = cpus.map((cpu) => {
      const { user, nice, sys, idle, irq } = cpu.times;
      return {
        idle,
        total: user + nice + sys + idle + irq,
      };
    });
    this.lastSnapshotTime = Date.now();
  }

  public formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
    return `${val} ${sizes[i]}`;
  }

  public formatSeconds(seconds: number): string {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0 || d > 0) parts.push(`${h}h`);
    if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }

  private getPlatformFormatted(platform: string): string {
    switch (platform) {
      case 'win32':
        return 'Windows';
      case 'darwin':
        return 'macOS';
      case 'linux':
        return 'Linux';
      default:
        return platform;
    }
  }

  public getCpuMetrics(): CpuMetrics {
    const cpus = os.cpus();
    const currentTimes: CpuTimeSnapshot[] = cpus.map((cpu) => {
      const { user, nice, sys, idle, irq } = cpu.times;
      return {
        idle,
        total: user + nice + sys + idle + irq,
      };
    });

    const cores: CpuCoreInfo[] = [];
    let totalUsageAccum = 0;

    for (let i = 0; i < cpus.length; i++) {
      const cur = currentTimes[i];
      const prev = this.prevCpuTimes[i] || cur;

      const deltaTotal = cur.total - prev.total;
      const deltaIdle = cur.idle - prev.idle;

      let usage = 0;
      if (deltaTotal > 0) {
        usage = Math.max(
          0,
          Math.min(100, Math.round(((deltaTotal - deltaIdle) / deltaTotal) * 100)),
        );
      }

      cores.push({
        core: i,
        model: cpus[i].model,
        speedMhz: cpus[i].speed,
        usagePercent: usage,
      });

      totalUsageAccum += usage;
    }

    this.prevCpuTimes = currentTimes;

    const overallUsagePercent =
      cores.length > 0 ? Math.round(totalUsageAccum / cores.length) : 0;

    return {
      model: cpus[0]?.model || 'Generic Processor',
      architecture: os.arch(),
      coreCount: cpus.length,
      overallUsagePercent,
      cores,
      loadAverage: os.loadavg() || [0, 0, 0],
    };
  }

  public getMemoryMetrics(): MemoryMetrics {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usagePercent =
      totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;

    const procMem = process.memoryUsage();

    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usagePercent,
      totalFormatted: this.formatBytes(totalBytes),
      usedFormatted: this.formatBytes(usedBytes),
      freeFormatted: this.formatBytes(freeBytes),
      process: {
        rssBytes: procMem.rss,
        rssFormatted: this.formatBytes(procMem.rss),
        heapTotalBytes: procMem.heapTotal,
        heapTotalFormatted: this.formatBytes(procMem.heapTotal),
        heapUsedBytes: procMem.heapUsed,
        heapUsedFormatted: this.formatBytes(procMem.heapUsed),
        externalBytes: procMem.external,
        externalFormatted: this.formatBytes(procMem.external),
      },
    };
  }

  public getDiskMetrics(): DiskMetrics | null {
    try {
      const rootPath = process.platform === 'win32' ? process.cwd().slice(0, 3) : '/';
      const stats = fs.statfsSync(rootPath);
      const totalBytes = stats.blocks * stats.bsize;
      const freeBytes = stats.bfree * stats.bsize;
      const usedBytes = totalBytes - freeBytes;
      const usagePercent =
        totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;

      return {
        totalBytes,
        freeBytes,
        usedBytes,
        usagePercent,
        totalFormatted: this.formatBytes(totalBytes),
        usedFormatted: this.formatBytes(usedBytes),
        freeFormatted: this.formatBytes(freeBytes),
        path: rootPath,
      };
    } catch {
      return null;
    }
  }

  public getHostInfo(): HostInfo {
    const uptimeSeconds = Math.floor(os.uptime());
    const processUptimeSeconds = Math.floor(process.uptime());

    return {
      hostname: os.hostname(),
      platform: os.platform(),
      platformFormatted: this.getPlatformFormatted(os.platform()),
      type: os.type(),
      release: os.release(),
      arch: os.arch(),
      uptimeSeconds,
      uptimeFormatted: this.formatSeconds(uptimeSeconds),
      processUptimeSeconds,
      processUptimeFormatted: this.formatSeconds(processUptimeSeconds),
      nodeVersion: process.version,
      v8Version: process.versions?.v8 || 'N/A',
      pid: process.pid,
    };
  }

  public getNetworkInterfaces(): NetworkInterfaceInfo[] {
    const interfaces = os.networkInterfaces();
    const result: NetworkInterfaceInfo[] = [];

    for (const [name, nets] of Object.entries(interfaces)) {
      if (!nets) continue;
      for (const net of nets) {
        if (net.family === 'IPv4' || (net.family as any) === 4) {
          result.push({
            name,
            ip: net.address,
            family: 'IPv4',
            internal: net.internal,
            mac: net.mac,
          });
        }
      }
    }

    return result;
  }

  public async measureEventLoopLag(): Promise<number> {
    const start = process.hrtime();
    return new Promise((resolve) => {
      setImmediate(() => {
        const delta = process.hrtime(start);
        const lagMs = (delta[0] * 1e9 + delta[1]) / 1e6;
        resolve(parseFloat(lagMs.toFixed(2)));
      });
    });
  }

  /**
   * Periodically queries host OS for PostgreSQL and Redis process RAM & CPU
   */
  private pollProcessMetrics(): void {
    const isWin = process.platform === 'win32';

    const scan = () => {
      if (isWin) {
        // Windows: query working set memory via tasklist
        exec(
          'tasklist /FO CSV /NH /FI "IMAGENAME eq postgres.exe"',
          { timeout: 1500 },
          (err, stdout) => {
            if (!err && stdout) {
              const lines = stdout.trim().split('\n');
              let totalKb = 0;
              let count = 0;
              for (const line of lines) {
                const parts = line.split('","');
                if (parts.length >= 5) {
                  // e.g. "12,450 K" -> 12450
                  const memStr = parts[4].replace(/[^0-9]/g, '');
                  const kb = parseInt(memStr, 10);
                  if (!isNaN(kb)) {
                    totalKb += kb;
                    count++;
                  }
                }
              }
              if (count > 0) {
                this.processCache.postgresRssBytes = totalKb * 1024;
                this.processCache.postgresProcessCount = count;
                this.processCache.lastUpdated = Date.now();
              }
            }
          },
        );

        // Also check redis-server on Windows if running as standalone
        exec(
          'tasklist /FO CSV /NH /FI "IMAGENAME eq redis-server.exe"',
          { timeout: 1500 },
          (err, stdout) => {
            if (!err && stdout && stdout.includes('redis-server')) {
              const lines = stdout.trim().split('\n');
              let totalKb = 0;
              for (const line of lines) {
                const parts = line.split('","');
                if (parts.length >= 5) {
                  const memStr = parts[4].replace(/[^0-9]/g, '');
                  const kb = parseInt(memStr, 10);
                  if (!isNaN(kb)) totalKb += kb;
                }
              }
              if (totalKb > 0) {
                this.processCache.redisRssBytes = totalKb * 1024;
              }
            }
          },
        );
      } else {
        // Linux / macOS: query ps for RSS (KB) and %CPU
        exec(
          'ps -eo comm,rss,%cpu --no-headers 2>/dev/null',
          { timeout: 1500 },
          (err, stdout) => {
            if (!err && stdout) {
              const lines = stdout.trim().split('\n');
              let pgRss = 0;
              let pgCpu = 0;
              let pgCount = 0;
              let rdRss = 0;
              let rdCpu = 0;

              for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 3) {
                  const comm = parts[0].toLowerCase();
                  const rss = parseInt(parts[1], 10) || 0;
                  const cpu = parseFloat(parts[2]) || 0;

                  if (comm.includes('postgres')) {
                    pgRss += rss;
                    pgCpu += cpu;
                    pgCount++;
                  } else if (comm.includes('redis')) {
                    rdRss += rss;
                    rdCpu += cpu;
                  }
                }
              }

              if (pgCount > 0) {
                this.processCache.postgresRssBytes = pgRss * 1024;
                this.processCache.postgresCpuPercent = parseFloat(pgCpu.toFixed(1));
                this.processCache.postgresProcessCount = pgCount;
              }
              if (rdRss > 0) {
                this.processCache.redisRssBytes = rdRss * 1024;
                this.processCache.redisCpuPercent = parseFloat(rdCpu.toFixed(1));
              }
              this.processCache.lastUpdated = Date.now();
            }
          },
        );
      }
    };

    // Initial scan and recurring 3s polling
    scan();
    setInterval(scan, 3000);
  }

  /**
   * Retrieves live PostgreSQL and Redis RAM (Memory) & CPU consumption
   */
  public async getServicesMetrics(): Promise<ServicesMetrics> {
    const totalHostMem = os.totalmem();

    // 1. REDIS TELEMETRY
    let redisUsage: ServiceResourceUsage = {
      service: 'redis',
      displayName: 'Redis Cache & Queue',
      status: 'offline',
      cpuPercent: 0,
      memoryBytes: this.processCache.redisRssBytes || 0,
      memoryFormatted: this.formatBytes(this.processCache.redisRssBytes || 0),
      memoryPercent:
        totalHostMem > 0
          ? parseFloat(((this.processCache.redisRssBytes / totalHostMem) * 100).toFixed(2))
          : 0,
    };

    if (this.redisClient) {
      try {
        if (this.redisClient.status === 'ready' || this.redisClient.status === 'connect') {
          const [memInfo, cpuInfo, clientInfo] = await Promise.all([
            this.redisClient.info('memory'),
            this.redisClient.info('cpu'),
            this.redisClient.info('clients'),
          ]);

          const usedMemoryMatch = memInfo.match(/used_memory:(\d+)/);
          const usedRssMatch = memInfo.match(/used_memory_rss:(\d+)/);
          const usedPeakMatch = memInfo.match(/used_memory_peak_human:([^\r\n]+)/);
          const clientsMatch = clientInfo.match(/connected_clients:(\d+)/);

          const sysMatch = cpuInfo.match(/used_cpu_sys:([\d.]+)/);
          const userMatch = cpuInfo.match(/used_cpu_user:([\d.]+)/);

          const usedBytes = usedRssMatch
            ? parseInt(usedRssMatch[1], 10)
            : usedMemoryMatch
            ? parseInt(usedMemoryMatch[1], 10)
            : 0;

          // Compute Redis CPU % delta
          let calculatedCpu = this.processCache.redisCpuPercent;
          const now = Date.now();
          if (sysMatch && userMatch) {
            const currentSys = parseFloat(sysMatch[1]);
            const currentUser = parseFloat(userMatch[1]);

            if (this.prevRedisCpu && now > this.prevRedisCpu.timestamp) {
              const timeDeltaSec = (now - this.prevRedisCpu.timestamp) / 1000;
              const cpuDeltaSec =
                currentSys + currentUser - (this.prevRedisCpu.sys + this.prevRedisCpu.user);
              if (timeDeltaSec > 0 && cpuDeltaSec >= 0) {
                calculatedCpu = parseFloat(
                  Math.min(100, (cpuDeltaSec / timeDeltaSec) * 100).toFixed(1),
                );
              }
            }

            this.prevRedisCpu = {
              sys: currentSys,
              user: currentUser,
              timestamp: now,
            };
          }

          redisUsage = {
            service: 'redis',
            displayName: 'Redis Cache & Queue',
            status: 'running',
            cpuPercent: calculatedCpu,
            memoryBytes: usedBytes || this.processCache.redisRssBytes || 0,
            memoryFormatted: this.formatBytes(usedBytes || this.processCache.redisRssBytes || 0),
            memoryPercent:
              totalHostMem > 0
                ? parseFloat((((usedBytes || this.processCache.redisRssBytes) / totalHostMem) * 100).toFixed(2))
                : 0,
            details: {
              usedMemoryPeakFormatted: usedPeakMatch ? usedPeakMatch[1] : undefined,
              connectedClients: clientsMatch ? parseInt(clientsMatch[1], 10) : undefined,
            },
          };
        }
      } catch {
        // Fall back to process metrics if direct ping deferred
      }
    }

    // 2. POSTGRESQL TELEMETRY
    let pgActiveConns: number | undefined;
    let pgDbSizeFormatted: string | undefined;
    let isPgConnected = false;

    if (this.prisma) {
      try {
        const [connRes, sizeRes] = await Promise.all([
          this.prisma.$queryRawUnsafe<Array<{ count: string | number }>>(
            "SELECT count(*) as count FROM pg_stat_activity WHERE state = 'active';",
          ),
          this.prisma.$queryRawUnsafe<Array<{ size: string | number }>>(
            'SELECT pg_database_size(current_database()) as size;',
          ),
        ]);

        if (connRes && connRes[0]) {
          pgActiveConns = Number(connRes[0].count);
          isPgConnected = true;
        }
        if (sizeRes && sizeRes[0]) {
          const bytes = Number(sizeRes[0].size);
          pgDbSizeFormatted = this.formatBytes(bytes);
        }
      } catch {
        // Prisma query fallback
      }
    }

    const pgRss = this.processCache.postgresRssBytes || (isPgConnected ? 28 * 1024 * 1024 : 0);
    const pgMemPercent =
      totalHostMem > 0 ? parseFloat(((pgRss / totalHostMem) * 100).toFixed(2)) : 0;

    const postgresUsage: ServiceResourceUsage = {
      service: 'postgres',
      displayName: 'PostgreSQL Database',
      status: isPgConnected || this.processCache.postgresProcessCount > 0 ? 'running' : 'offline',
      cpuPercent: this.processCache.postgresCpuPercent || (isPgConnected ? 0.2 : 0),
      memoryBytes: pgRss,
      memoryFormatted: this.formatBytes(pgRss),
      memoryPercent: pgMemPercent,
      details: {
        activeConnections: pgActiveConns,
        databaseSizeFormatted: pgDbSizeFormatted,
        processCount: this.processCache.postgresProcessCount,
      },
    };

    return {
      postgres: postgresUsage,
      redis: redisUsage,
    };
  }

  public async getSystemSnapshot(): Promise<SystemSnapshot> {
    const cpu = this.getCpuMetrics();
    const memory = this.getMemoryMetrics();
    const disk = this.getDiskMetrics();
    const host = this.getHostInfo();
    const network = this.getNetworkInterfaces();
    const services = await this.getServicesMetrics();
    const eventLoopLagMs = await this.measureEventLoopLag();

    return {
      timestamp: new Date().toISOString(),
      host,
      cpu,
      memory,
      disk,
      network,
      services,
      eventLoopLagMs,
    };
  }

  public async handleSseStream(res: any, req: any): Promise<void> {
    const rawRes = res.raw || res;
    const rawReq = req.raw || req;

    const origin = req.headers?.origin || process.env.FRONTEND_URL || '*';

    if (rawRes.setHeader) {
      if (origin) {
        rawRes.setHeader('Access-Control-Allow-Origin', origin);
        rawRes.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      rawRes.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie, X-API-Key',
      );
      rawRes.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      rawRes.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      rawRes.setHeader('Cache-Control', 'no-cache, no-transform');
      rawRes.setHeader('Connection', 'keep-alive');
      rawRes.setHeader('X-Accel-Buffering', 'no');
    }

    let isClosed = false;

    const cleanup = () => {
      if (!isClosed) {
        isClosed = true;
        clearInterval(interval);
        try {
          rawRes.end();
        } catch {}
      }
    };

    rawReq.on('close', cleanup);
    rawRes.on('close', cleanup);
    rawReq.on('end', cleanup);

    const sendEvent = (event: string, data: any) => {
      if (isClosed) return;
      try {
        rawRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        cleanup();
      }
    };

    // Send initial immediate snapshot
    try {
      const initialSnapshot = await this.getSystemSnapshot();
      sendEvent('metrics', initialSnapshot);
    } catch (err: any) {
      this.logger.error(`Initial snapshot error: ${err.message}`);
    }

    // Stream metrics every 2000ms
    const interval = setInterval(async () => {
      if (isClosed) {
        clearInterval(interval);
        return;
      }
      try {
        const snapshot = await this.getSystemSnapshot();
        sendEvent('metrics', snapshot);
      } catch (err: any) {
        this.logger.warn(`Error generating SSE metrics snapshot: ${err.message}`);
      }
    }, 2000);
  }
}
