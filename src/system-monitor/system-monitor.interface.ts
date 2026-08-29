export interface CpuCoreInfo {
  core: number;
  model: string;
  speedMhz: number;
  usagePercent: number;
}

export interface CpuMetrics {
  model: string;
  architecture: string;
  coreCount: number;
  overallUsagePercent: number;
  cores: CpuCoreInfo[];
  loadAverage: number[]; // 1m, 5m, 15m
}

export interface MemoryMetrics {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
  totalFormatted: string;
  usedFormatted: string;
  freeFormatted: string;
  process: {
    rssBytes: number;
    rssFormatted: string;
    heapTotalBytes: number;
    heapTotalFormatted: string;
    heapUsedBytes: number;
    heapUsedFormatted: string;
    externalBytes: number;
    externalFormatted: string;
  };
}

export interface DiskMetrics {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
  totalFormatted: string;
  usedFormatted: string;
  freeFormatted: string;
  path: string;
}

export interface HostInfo {
  hostname: string;
  platform: string;
  platformFormatted: string;
  type: string;
  release: string;
  arch: string;
  uptimeSeconds: number;
  uptimeFormatted: string;
  processUptimeSeconds: number;
  processUptimeFormatted: string;
  nodeVersion: string;
  v8Version: string;
  pid: number;
}

export interface NetworkInterfaceInfo {
  name: string;
  ip: string;
  family: string;
  internal: boolean;
  mac: string;
}

export interface ServiceResourceUsage {
  service: 'postgres' | 'redis';
  displayName: string;
  status: 'running' | 'stopped' | 'offline';
  cpuPercent: number;
  memoryBytes: number;
  memoryFormatted: string;
  memoryPercent: number; // % of total host RAM
  details?: {
    activeConnections?: number;
    databaseSizeFormatted?: string;
    usedMemoryRssBytes?: number;
    usedMemoryPeakFormatted?: string;
    connectedClients?: number;
    processCount?: number;
  };
}

export interface ServicesMetrics {
  postgres: ServiceResourceUsage;
  redis: ServiceResourceUsage;
}

export interface SystemSnapshot {
  timestamp: string;
  host: HostInfo;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disk: DiskMetrics | null;
  network: NetworkInterfaceInfo[];
  services: ServicesMetrics;
  eventLoopLagMs: number;
}
