// Simple lightweight health status service
export class KeepAliveService {
  private isRunning = false;

  start(): void {
    this.isRunning = true;
    // Simple service - no aggressive operations
  }

  stop(): void {
    this.isRunning = false;
  }

  getStatus(): any {
    return {
      isRunning: this.isRunning,
      uptime: Math.floor(process.uptime()),
      status: 'healthy'
    };
  }
}

// Simple lightweight service instance
export const keepAliveService = new KeepAliveService();

// Export status for health checks
export const getKeepAliveStatus = () => keepAliveService.getStatus();
