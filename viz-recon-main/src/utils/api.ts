/**
 * API utilities for ReconX frontend
 */

// Resolve API base URL based on environment
export function apiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const storedBase = typeof window !== 'undefined' ? window.localStorage.getItem('API_BASE_URL') || undefined : undefined;
  const devDefault = (import.meta as any).env?.DEV ? 'http://127.0.0.1:8000' : undefined;
  const baseUrl = envBase || storedBase || devDefault;
  return baseUrl && (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) ? baseUrl.replace(/\/$/, '') : '';
}

export function api(path: string): string {
  const base = apiBase();
  const p = path.startsWith('/') ? path : `/${path}`;
  const isHealth = p.startsWith('/healthz');
  const needsApiPrefix = !isHealth && !p.startsWith('/api/');
  if (base) {
    return `${base}${needsApiPrefix ? '/api' : ''}${p}`;
  }
  return `${needsApiPrefix ? '/api' : ''}${p}`;
}

// Enhanced fetch wrapper with error handling
export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const url = typeof input === 'string' || input instanceof URL ? input.toString() : (input as Request).url;
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
    ...init,
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText} @ ${url}`;
    try {
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const errorData = await response.json();
        errorMessage = `${errorMessage} -> ${errorData.detail || errorData.message || JSON.stringify(errorData)}`;
      } else {
        const text = await response.text();
        if (text) errorMessage = `${errorMessage} -> ${text.substring(0, 500)}`;
      }
    } catch {
      // Fallback to status text if JSON parsing fails
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

// API endpoint types
export interface Metrics {
  findings_total: number;
  findings_per_min: number;
  started_jobs?: number;
  completed_jobs?: number;
  failed_jobs?: number;
}

export interface Job {
  id: string;
  type: 'subdomains' | 'ports' | 'dirs';
  state: 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  progress: number;
  created_at: string;
  targets?: string[];
  domain?: string;
  base_url?: string;
}

export interface JobDetails extends Job {
  config: Record<string, any>;
  error?: string;
}

export interface Finding {
  id: string;
  job_id: string;
  // Subdomain findings
  subdomain?: string;
  resolved_ips?: string[];
  first_seen?: string;
  last_seen?: string;
  // Port findings
  target?: string;
  port?: number;
  status?: string | number;
  banner?: string;
  // Directory findings
  url?: string;
  length?: number;
  title?: string;
}

// Scan request types
export interface SubdomainScanRequest {
  domain: string;
  authorized: boolean;
  concurrency?: number;
  timeout?: number;
  resolvers?: string[];
}

export interface PortScanRequest {
  targets: string[];
  authorized: boolean;
  ports?: number[];
  timeout?: number;
}

export interface DirectoryScanRequest {
  base_url: string;
  authorized: boolean;
  extensions?: string[] | string;
  wordlist?: string[] | string;
  status_include?: number[] | string;
  auth?: string;
  proxies?: string | Record<string, string>;
  timeout?: number;
}