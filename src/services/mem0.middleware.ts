// Stub file for Mem0Middleware - placeholder for future implementation
export interface Mem0Config {
  apiKey?: string;
  baseUrl?: string;
}

export function getMem0Middleware(config?: Mem0Config) {
  return {
    add: async (text: string) => ({ success: true }),
    search: async (query: string) => ({ results: [] })
  };
}
