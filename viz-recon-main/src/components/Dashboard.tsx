import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, Shield, ShieldAlert, Play, Pause, Square, Trash2, Download, Eye, Search, Globe, FolderOpen } from 'lucide-react';
import { api, apiBase, fetchJson, type Metrics, type Job, type JobDetails, type Finding, type SubdomainScanRequest, type PortScanRequest, type DirectoryScanRequest } from '../utils/api';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Document, Packer, Paragraph, TextRun, Table as DocxTable, TableRow, TableCell, HeadingLevel, AlignmentType, WidthType } from 'docx';
import { formatDateTime } from '../utils/date';

// Isolated Job Details Modal: handles its own polling and findings state per job
const JobDetailsModal: React.FC<{ jobId: string; initial?: Job; onClose: () => void }> = ({ jobId, initial, onClose }) => {
  const [job, setJob] = useState<JobDetails | null>(initial ? ({ ...initial, config: {} } as unknown as JobDetails) : null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [dirFilter, setDirFilter] = useState<{ text: string; status: string }>({ text: '', status: '' });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Abort any in-flight requests before starting new ones
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const ts = Date.now();
      const [jobData, findingsData] = await Promise.all([
        fetchJson<JobDetails>(api(`/jobs/${jobId}`) + `?t=${ts}`, { signal: controller.signal }),
        fetchJson<Finding[]>(api(`/jobs/${jobId}/findings`) + `?t=${ts}`, { signal: controller.signal })
      ]);
      // Defensive filtering: ensure only this job's findings and expected kind if known
      const sid = String(jobId);
      const expectedKind = jobData.type === 'dirs' ? 'dir' : jobData.type === 'ports' ? 'port' : jobData.type === 'subdomains' ? 'subdomain' : undefined;
      const purified = (findingsData || []).filter((f: any) => String(f?.job_id ?? '') === sid && (!expectedKind || f?.kind === expectedKind));
      setJob(jobData);
      setFindings(purified);
    } catch (err) {
      // Ignore abort errors; log others
      if ((err as any)?.name !== 'AbortError') {
        console.error('Job refresh error:', err);
      }
    }
  }, [jobId]);

  useEffect(() => {
    // Reset findings immediately on job change, start fresh polling
    setFindings([]);
    if (abortRef.current) abortRef.current.abort();
    if (pollRef.current) clearInterval(pollRef.current);
    refresh();
    pollRef.current = setInterval(refresh, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [refresh, jobId]);

  const getStatusBadge = (state: string) => {
    const baseClasses = 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium';
    switch (state) {
      case 'running':
        return `${baseClasses} bg-status-running/20 text-status-running border border-status-running/30`;
      case 'paused':
        return `${baseClasses} bg-status-paused/20 text-status-paused border border-status-paused/30`;
      case 'completed':
        return `${baseClasses} bg-success/20 text-success border border-success/30`;
      case 'cancelled':
        return `${baseClasses} bg-status-cancelled/20 text-status-cancelled border border-status-cancelled/30`;
      case 'failed':
        return `${baseClasses} bg-destructive/20 text-destructive border border-destructive/30`;
      default:
        return `${baseClasses} bg-muted/20 text-muted-foreground border border-muted/30`;
    }
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-gradient-card rounded-lg border border-border shadow-card max-w-4xl w-full max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">
            Job Details - {job?.type ?? '...'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors">×</button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(80vh-120px)]">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <span className="text-sm text-muted-foreground">Status:</span>
              <div className={getStatusBadge(job?.state || 'running')}>{job?.state || 'running'}</div>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Progress:</span>
              <div className="text-sm font-medium text-foreground">{(job?.progress ?? 0).toFixed(1)}%</div>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Created:</span>
              <div className="text-sm font-medium text-foreground">{job?.created_at ? formatDateTime(job.created_at) : '...'}</div>
            </div>
          </div>

          {job?.error && (
            <div className="bg-destructive/20 border border-destructive/30 rounded-lg p-3">
              <p className="text-sm text-destructive font-medium">Error:</p>
              <p className="text-sm text-destructive">{job.error}</p>
            </div>
          )}

          <div className="w-full bg-muted rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all duration-300 ${
                job?.state === 'completed' ? 'bg-gradient-success' :
                job?.state === 'cancelled' ? 'bg-status-cancelled' :
                job?.state === 'failed' ? 'bg-destructive' :
                'bg-gradient-primary'
              }`}
              style={{ width: `${Math.min(job?.progress ?? 0, 100)}%` }}
            />
          </div>

          <div>
            <h4 className="text-md font-semibold text-foreground mb-3">Findings ({findings.length})</h4>
            {job?.type === 'dirs' && (
              <div className="flex items-end gap-3 mb-3">
                <div className="flex-1">
                  <label className="block text-xs text-muted-foreground mb-1">Filter text</label>
                  <input
                    type="text"
                    value={dirFilter.text}
                    onChange={(e) => setDirFilter({ ...dirFilter, text: e.target.value })}
                    placeholder="Search url, title, type"
                    className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder-muted-foreground"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Status</label>
                  <select
                    value={dirFilter.status}
                    onChange={(e) => setDirFilter({ ...dirFilter, status: e.target.value })}
                    className="px-3 py-2 bg-input border border-border rounded-md text-foreground"
                  >
                    <option value="">All</option>
                    <option value="2xx">2xx</option>
                    <option value="3xx">3xx</option>
                    <option value="4xx">4xx</option>
                    <option value="5xx">5xx</option>
                  </select>
                </div>
              </div>
            )}

            <div className="bg-secondary/30 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 text-muted-foreground">
                    <tr>
                      {job?.type === 'subdomains' && (
                        <>
                          <th className="px-3 py-2 text-left">Subdomain</th>
                          <th className="px-3 py-2 text-left">IPs</th>
                          <th className="px-3 py-2 text-left">First Seen</th>
                          <th className="px-3 py-2 text-left">Last Seen</th>
                        </>
                      )}
                      {job?.type === 'ports' && (
                        <>
                          <th className="px-3 py-2 text-left">Target</th>
                          <th className="px-3 py-2 text-left">Port</th>
                          <th className="px-3 py-2 text-left">Status</th>
                          <th className="px-3 py-2 text-left">Banner</th>
                        </>
                      )}
                      {job?.type === 'dirs' && (
                        <>
                          <th className="px-3 py-2 text-left">URL</th>
                          <th className="px-3 py-2 text-left">Status</th>
                          <th className="px-3 py-2 text-left">Length</th>
                          <th className="px-3 py-2 text-left">Title</th>
                          <th className="px-3 py-2 text-left">Type</th>
                          <th className="px-3 py-2 text-left">Redirect To</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="text-foreground">
                    {(
                      job?.type !== 'dirs'
                        ? findings
                        : findings.filter((f) => {
                            const raw = (f as any).status;
                            const s = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
                            const bucket = Number.isFinite(s)
                              ? s >= 500
                                ? '5xx'
                                : s >= 400
                                ? '4xx'
                                : s >= 300
                                ? '3xx'
                                : '2xx'
                              : '';
                            const statusOk = !dirFilter.status || dirFilter.status === bucket;
                            const t = dirFilter.text.trim().toLowerCase();
                            const textOk =
                              !t ||
                              [String((f as any).url || ''), String((f as any).title || ''), String((f as any).content_type || '')]
                                .join(' ')
                                .toLowerCase()
                                .includes(t);
                            return statusOk && textOk;
                          })
                    ).map((finding, idx) => (
                      <tr key={`${jobId}-${idx}`} className="border-b border-border/50 hover:bg-accent/30">
                        {job?.type === 'subdomains' && (
                          <>
                            <td className="px-3 py-2 font-mono text-sm">{(finding as any).subdomain}</td>
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{(finding as any).resolved_ips?.join(', ') || 'N/A'}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{(finding as any).first_seen ? formatDateTime((finding as any).first_seen) : 'N/A'}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{(finding as any).last_seen ? formatDateTime((finding as any).last_seen) : 'N/A'}</td>
                          </>
                        )}
                        {job?.type === 'ports' && (
                          <>
                            <td className="px-3 py-2 font-mono text-sm">{(finding as any).target}</td>
                            <td className="px-3 py-2 font-mono text-sm">{(finding as any).port}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`px-2 py-1 rounded text-xs ${
                                  (finding as any).status === 'open' ? 'bg-success/20 text-success' : 'bg-muted/20 text-muted-foreground'
                                }`}
                              >
                                {(finding as any).status}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground max-w-32 truncate">{(finding as any).banner || 'N/A'}</td>
                          </>
                        )}
                        {job?.type === 'dirs' && (
                          <>
                            <td className="px-3 py-2 font-mono text-sm max-w-48 truncate">{(finding as any).url}</td>
                            <td className="px-3 py-2">
                              {(() => {
                                const raw = (finding as any).status ?? (finding as any).code ?? (finding as any).http_status;
                                const s = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
                                const isNum = Number.isFinite(s);
                                const bucket = isNum ? (s >= 500 ? '5xx' : s >= 400 ? '4xx' : s >= 300 ? '3xx' : '2xx') : '';
                                const borderCls =
                                  bucket === '2xx'
                                    ? 'border-success/50 bg-success/10'
                                    : bucket === '3xx'
                                    ? 'border-primary/50 bg-primary/10'
                                    : bucket === '4xx'
                                    ? 'border-warning/50 bg-warning/10'
                                    : bucket === '5xx'
                                    ? 'border-destructive/50 bg-destructive/10'
                                    : 'border-border bg-muted/10';
                                const dotCls =
                                  bucket === '2xx'
                                    ? 'bg-success'
                                    : bucket === '3xx'
                                    ? 'bg-primary'
                                    : bucket === '4xx'
                                    ? 'bg-warning'
                                    : bucket === '5xx'
                                    ? 'bg-destructive'
                                    : 'bg-border';
                                const label = isNum ? String(s) : raw != null ? String(raw) : 'N/A';
                                return (
                                  <span className={`inline-flex items-center gap-1 min-w-[2.5rem] justify-center px-2 py-0.5 rounded text-xs font-mono border text-foreground ${borderCls}`}>
                                    <span className={`inline-block w-2 h-2 rounded-full ${dotCls}`}></span>
                                    {label}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{(finding as any).length || 'N/A'}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground max-w-32 truncate">{(finding as any).title || 'N/A'}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground max-w-32 truncate">{(finding as any).content_type || 'N/A'}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground max-w-48 truncate">{(finding as any).redirected_to ?? 'N/A'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {findings.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">No findings yet. Check back as the scan progresses.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Dashboard: React.FC = () => {
  // State management
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [isBackendOnline, setIsBackendOnline] = useState(false);
  const [activeTab, setActiveTab] = useState<'subdomains' | 'ports' | 'dirs'>('subdomains');
  const activeJobIdRef = useRef<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<'jobs' | 'results' | 'report'>('jobs');
  const [resultsTab, setResultsTab] = useState<'subdomains' | 'ports' | 'dirs'>('subdomains');
  const [reportType, setReportType] = useState<'subdomains' | 'ports' | 'dirs'>('dirs');
  const [reportJobId, setReportJobId] = useState<string>('');

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const formatJobLabel = (j: Job) => {
  const when = j.created_at ? formatDateTime(j.created_at) : '';
    if (j.type === 'dirs') return `${j.base_url || 'URL'} • ${when}`;
    if (j.type === 'subdomains') return `${j.domain || 'Domain'} • ${when}`;
    if (j.type === 'ports') return `${(j.targets && j.targets[0]) || 'Targets'} • ${when}`;
    return `${j.id} • ${when}`;
  };

  const buildReportTable = (job: Job, findings: Finding[]) => {
    if (job.type === 'dirs') {
      const headers = ['URL', 'Status', 'Length', 'Title', 'Type', 'Redirect'];
      const rows = findings.map((f: any) => [
        String(f.url || ''),
        String(f.status ?? f.code ?? f.http_status ?? ''),
        String(f.length ?? ''),
        String(f.title || ''),
        String(f.content_type || ''),
        String(f.redirected_to ?? ''),
      ]);
      return { headers, rows };
    }
    if (job.type === 'ports') {
      const headers = ['Target', 'Port', 'Status', 'Banner'];
      const rows = findings.map((f: any) => [
        String(f.target || ''),
        String(f.port ?? ''),
        String(f.status || ''),
        String(f.banner || ''),
      ]);
      return { headers, rows };
    }
    const headers = ['Subdomain', 'IPs', 'First Seen', 'Last Seen'];
    const rows = findings.map((f: any) => [
      String(f.subdomain || ''),
      Array.isArray(f.resolved_ips) ? f.resolved_ips.join(', ') : '',
  f.first_seen ? formatDateTime(f.first_seen) : '',
  f.last_seen ? formatDateTime(f.last_seen) : '',
    ]);
    return { headers, rows };
  };

  const exportPDF = async (job: Job) => {
    try {
      const data = await fetchJson<Finding[]>(api(`/jobs/${job.id}/findings`) + `?t=${Date.now()}`);
      const table = buildReportTable(job, data);
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const title = `ReconX Report — ${job.type.toUpperCase()} (${formatJobLabel(job)})`;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(title, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
  doc.text(`Generated: ${formatDateTime(new Date())}`, 40, 60);
      autoTable(doc, {
        startY: 80,
        head: [table.headers],
        body: table.rows,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [24, 104, 221] },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        margin: { left: 40, right: 40 },
      });
      const filename = `reconx_${job.type}_${job.id}.pdf`;
      doc.save(filename);
      toast.success('PDF exported');
    } catch (e: any) {
      toast.error('PDF export failed', { description: e?.message || String(e) });
    }
  };

  const exportTXT = async (job: Job) => {
    try {
      const data = await fetchJson<Finding[]>(api(`/jobs/${job.id}/findings`) + `?t=${Date.now()}`);
      const table = buildReportTable(job, data);
      const lines = [] as string[];
      lines.push(`# ReconX Report — ${job.type.toUpperCase()} (${formatJobLabel(job)})`);
  lines.push(`Generated: ${formatDateTime(new Date())}`);
      lines.push('');
      lines.push(table.headers.join('\t'));
      for (const row of table.rows) lines.push(row.map((c) => String(c)).join('\t'));
      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, `reconx_${job.type}_${job.id}.txt`);
      toast.success('TXT exported');
    } catch (e: any) {
      toast.error('TXT export failed', { description: e?.message || String(e) });
    }
  };

  const exportDOCX = async (job: Job) => {
    try {
      const data = await fetchJson<Finding[]>(api(`/jobs/${job.id}/findings`) + `?t=${Date.now()}`);
      const table = buildReportTable(job, data);
      const title = `ReconX Report — ${job.type.toUpperCase()} (${formatJobLabel(job)})`;
      const rows = [
        new TableRow({
          children: table.headers.map((h) => new TableCell({ children: [new Paragraph({ text: String(h), heading: HeadingLevel.HEADING_6 })] })),
        }),
        ...table.rows.map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph(String(c))] })) })),
      ];
      const doc = new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                text: title,
                heading: HeadingLevel.HEADING_2,
              }),
              new Paragraph({ text: `Generated: ${formatDateTime(new Date())}` }),
              new Paragraph({ text: '' }),
              new DocxTable({
                rows,
                width: { size: 100, type: WidthType.PERCENTAGE },
              }),
            ],
          },
        ],
      });
      const blob = await Packer.toBlob(doc);
      downloadBlob(blob, `reconx_${job.type}_${job.id}.docx`);
      toast.success('DOCX exported');
    } catch (e: any) {
      toast.error('DOCX export failed', { description: e?.message || String(e) });
    }
  };
  
  // Form states
  const [subdomainForm, setSubdomainForm] = useState({
    domain: '',
    authorized: false,
    concurrency: 50,
    timeout: 10,
    resolvers: '',
    useResolversFile: false,
  });
  
  const [portForm, setPortForm] = useState({
    targets: '',
    authorized: false,
    ports: '80,443,8080,8443',
    timeout: 10,
    useTargetsFile: false,
    usePortsFile: false,
  });
  
  const [dirForm, setDirForm] = useState({
    base_url: '',
    authorized: false,
    extensions: 'php,html,js,txt',
    timeout: 10,
    status_include: '',
    auth: '',
    proxies: '',
    useUpload: false,
    wordlistText: '',
    retries: 1,
    qps_per_host: '',
    preset: 'Standard' as 'Safe' | 'Standard' | 'Aggressive',
  });

  // Helpers
  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  };

  // Fetch functions
  const fetchMetrics = useCallback(async () => {
    try {
      const data = await fetchJson<Metrics>(api('/metrics'));
      setMetrics(data);
      setIsBackendOnline(true);
    } catch (error) {
      // Fallback: try health endpoint to determine online/offline
      try {
        const base = apiBase();
        const healthUrl = base ? `${base}/healthz` : '/healthz';
        const res = await fetch(healthUrl, { cache: 'no-store' });
        if (res.ok) {
          setIsBackendOnline(true);
        } else {
          setIsBackendOnline(false);
        }
      } catch (e) {
        setIsBackendOnline(false);
      }
      console.error('Failed to fetch metrics:', error);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const data = await fetchJson<Job[]>(api('/jobs'));
      setJobs(data);
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    }
  }, []);

  // Removed fetchJobDetails; the modal handles per-job polling

  // Job actions
  const handleJobAction = async (jobId: string, action: 'pause' | 'resume' | 'cancel') => {
    try {
      await fetchJson(api(`/jobs/${jobId}/${action}`), { method: 'POST' });
      toast.success(`Job ${action} requested`, { description: `Job #${jobId}` });
      await fetchJobs(); // Immediate refresh
      // Modal will self-refresh via polling if open
    } catch (error) {
      console.error(`Failed to ${action} job:`, error);
      const msg = error instanceof Error ? error.message : 'Request failed';
      toast.error(`Failed to ${action} job`, { description: msg });
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      await fetch(api(`/jobs/${jobId}`), { method: 'DELETE' });
      toast.success('Job deleted', { description: `Job #${jobId}` });
      await fetchJobs(); // Immediate refresh
      if (selectedJob?.id === jobId) {
        setSelectedJob(null);
      }
    } catch (error) {
      console.error('Failed to delete job:', error);
      const msg = error instanceof Error ? error.message : 'Request failed';
      toast.error('Failed to delete job', { description: msg });
    }
  };

  // Scan submissions
  const handleSubdomainScan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let resolvers: string[] | undefined = undefined;
      if (subdomainForm.useResolversFile) {
        const input = document.getElementById('subdomain-resolvers-file') as HTMLInputElement | null;
        if (!input || !input.files || input.files.length === 0) {
          throw new Error('Please choose a resolvers file or disable file mode');
        }
        const txt = await readFileAsText(input.files[0]);
        resolvers = txt
          .split(/\r?\n|,|\s+/)
          .map(s => s.trim())
          .filter(Boolean);
      }
      const request: SubdomainScanRequest = {
        domain: subdomainForm.domain,
        authorized: subdomainForm.authorized,
        concurrency: subdomainForm.concurrency,
        timeout: subdomainForm.timeout,
        ...(resolvers ? { resolvers } : (subdomainForm.resolvers ? { resolvers: subdomainForm.resolvers.split(',').map(r => r.trim()).filter(Boolean) } : {}))
      };
      const res = await fetchJson<{ status: string; job_id: number }>(api('/recon/subdomains/scan'), {
        method: 'POST',
        body: JSON.stringify(request)
      });
      toast.success('Subdomain scan started', { description: `Job #${res.job_id}` });
      setSubdomainForm({ ...subdomainForm, domain: '', authorized: false, resolvers: '', useResolversFile: false });
      await fetchJobs();
    } catch (error) {
      console.error('Failed to start subdomain scan:', error);
      const msg = error instanceof Error ? error.message : 'Request failed';
      toast.error('Subdomain scan failed', { description: msg });
    }
  };

  const handlePortScan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let targetsStr = portForm.targets;
      if (portForm.useTargetsFile) {
        const input = document.getElementById('port-targets-file') as HTMLInputElement | null;
        if (!input || !input.files || input.files.length === 0) {
          throw new Error('Please choose a targets file or disable file mode');
        }
        const txt = await readFileAsText(input.files[0]);
        targetsStr = txt;
      }
      let portsStr = portForm.ports;
      if (portForm.usePortsFile) {
        const input = document.getElementById('port-ports-file') as HTMLInputElement | null;
        if (!input || !input.files || input.files.length === 0) {
          throw new Error('Please choose a ports file or disable file mode');
        }
        const txt = await readFileAsText(input.files[0]);
        portsStr = txt;
      }
      const portsList = portsStr
        ? portsStr
            .split(/[\s,]+/)
            .map(p => parseInt(p.trim(), 10))
            .filter(n => Number.isFinite(n))
        : undefined;
      const request: PortScanRequest = {
        targets: targetsStr
          .split(/[\s,]+/)
          .map(t => t.trim())
          .filter(Boolean),
        authorized: portForm.authorized,
        ports: portsList as number[] | undefined,
        timeout: portForm.timeout
      };
      const res = await fetchJson<{ status: string; job_id: number }>(api('/recon/ports/scan'), {
        method: 'POST',
        body: JSON.stringify(request)
      });
      toast.success('Port scan started', { description: `Job #${res.job_id}` });
      setPortForm({ ...portForm, targets: '', authorized: false, ports: '80,443,8080,8443', useTargetsFile: false, usePortsFile: false });
      await fetchJobs();
    } catch (error) {
      console.error('Failed to start port scan:', error);
      const msg = error instanceof Error ? error.message : 'Request failed';
      toast.error('Port scan failed', { description: msg });
    }
  };

  const handleDirScan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (dirForm.useUpload && dirForm.wordlistText) {
        // When "upload" is toggled but wordlist provided as text, send via standard JSON route
        const request: DirectoryScanRequest & { retries?: number; qps_per_host?: number } = {
          base_url: dirForm.base_url,
          authorized: dirForm.authorized,
          extensions: dirForm.extensions,
          status_include: dirForm.status_include,
          auth: dirForm.auth || undefined,
          proxies: dirForm.proxies || undefined,
          timeout: dirForm.timeout,
          wordlist: dirForm.wordlistText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        } as any;
        if (dirForm.retries) (request as any).retries = dirForm.retries;
        const qps = parseFloat(dirForm.qps_per_host);
        if (!Number.isNaN(qps) && qps > 0) (request as any).qps_per_host = qps;
        const res = await fetchJson<{ status: string; job_id: number }>(api('/recon/dirs/scan'), {
          method: 'POST',
          body: JSON.stringify(request)
        });
        toast.success('Directory scan started', { description: `Job #${res.job_id}` });
        setDirForm({ ...dirForm, base_url: '', authorized: false, wordlistText: '' });
        await fetchJobs();
        return;
      }
      if (dirForm.useUpload) {
        // Use multipart upload endpoint
        const formData = new FormData();
        formData.append('base_url', dirForm.base_url);
        formData.append('authorized', String(dirForm.authorized));
        formData.append('timeout', String(dirForm.timeout));
        formData.append('project', 'default');
  if (dirForm.status_include) formData.append('status_include', dirForm.status_include);
        if (dirForm.extensions) formData.append('extensions', dirForm.extensions);
        if (dirForm.auth) formData.append('auth', dirForm.auth);
        if (dirForm.proxies) formData.append('proxies', dirForm.proxies);
  if (dirForm.retries) formData.append('retries', String(dirForm.retries));
  if (dirForm.qps_per_host && !Number.isNaN(parseFloat(dirForm.qps_per_host))) formData.append('qps_per_host', dirForm.qps_per_host);
        const fileInput = document.getElementById('dir-wordlist-file') as HTMLInputElement | null;
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
          throw new Error('Please choose a wordlist file');
        }
        formData.append('wordlist_file', fileInput.files[0]);
        const resp = await fetch(api('/recon/dirs/scan/upload'), { method: 'POST', body: formData });
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`HTTP ${resp.status} @ /recon/dirs/scan/upload -> ${txt}`);
        }
        const res = await resp.json();
        toast.success('Directory scan started', { description: `Job #${res.job_id}` });
        setDirForm({ ...dirForm, base_url: '', authorized: false });
        await fetchJobs();
        return;
      }
      // Default JSON path
      const request: DirectoryScanRequest & { retries?: number; qps_per_host?: number } = {
        base_url: dirForm.base_url,
        authorized: dirForm.authorized,
        extensions: dirForm.extensions,
        status_include: dirForm.status_include,
        auth: dirForm.auth || undefined,
        proxies: dirForm.proxies || undefined,
        timeout: dirForm.timeout
      } as any;
      if (dirForm.retries) (request as any).retries = dirForm.retries;
      const qps0 = parseFloat(dirForm.qps_per_host);
      if (!Number.isNaN(qps0) && qps0 > 0) (request as any).qps_per_host = qps0;
      const res = await fetchJson<{ status: string; job_id: number }>(api('/recon/dirs/scan'), {
        method: 'POST',
        body: JSON.stringify(request)
      });
      toast.success('Directory scan started', { description: `Job #${res.job_id}` });
      setDirForm({ ...dirForm, base_url: '', authorized: false });
      await fetchJobs();
    } catch (error) {
      console.error('Failed to start directory scan:', error);
      const msg = error instanceof Error ? error.message : 'Request failed';
      toast.error('Directory scan failed', { description: msg });
    }
  };

  // Polling effects
  useEffect(() => {
    fetchMetrics();
    fetchJobs();
    
    const metricsInterval = setInterval(fetchMetrics, 3000);
    const jobsInterval = setInterval(fetchJobs, 3000);
    
    return () => {
      clearInterval(metricsInterval);
      clearInterval(jobsInterval);
    };
  }, [fetchMetrics, fetchJobs]);

  // Removed findings polling effect; handled inside JobDetailsModal

  const getStatusBadge = (state: string, progress: number) => {
    const baseClasses = "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium";
    
    switch (state) {
      case 'running':
        return `${baseClasses} bg-status-running/20 text-status-running border border-status-running/30`;
      case 'paused':
        return `${baseClasses} bg-status-paused/20 text-status-paused border border-status-paused/30`;
      case 'completed':
        return `${baseClasses} bg-success/20 text-success border border-success/30`;
      case 'cancelled':
        return `${baseClasses} bg-status-cancelled/20 text-status-cancelled border border-status-cancelled/30`;
      case 'failed':
        return `${baseClasses} bg-destructive/20 text-destructive border border-destructive/30`;
      default:
        return `${baseClasses} bg-muted/20 text-muted-foreground border border-muted/30`;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header with metrics */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/reconx-logo.png" alt="ReconX" className="h-8 w-8 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).src = '/favicon.ico'; }} />
            <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              ReconX Dashboard
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
              isBackendOnline 
                ? 'bg-success/20 text-success border border-success/30' 
                : 'bg-destructive/20 text-destructive border border-destructive/30'
            }`}>
              {isBackendOnline ? <Shield className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
              Backend: {isBackendOnline ? 'Online' : 'Offline'}
            </div>
          </div>
        </div>

        {/* Metrics bar */}
        {metrics && (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gradient-card rounded-lg p-4 border border-border shadow-card">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/20 rounded-lg">
                  <Activity className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Findings</p>
                  <p className="text-2xl font-bold text-foreground">{metrics.findings_total.toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div className="bg-gradient-card rounded-lg p-4 border border-border shadow-card">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-success/20 rounded-lg">
                  <Activity className="w-5 h-5 text-success" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Findings/Min</p>
                  <p className="text-2xl font-bold text-foreground">{metrics.findings_per_min.toFixed(1)}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-240px)]">
          {/* New Scan panel */}
          <div className="bg-gradient-card rounded-lg border border-border shadow-card p-4">
            <h2 className="text-lg font-semibold mb-4 text-foreground">New Scan</h2>
            
            {/* Tab navigation */}
            <div className="flex border-b border-border mb-4">
              {[
                { id: 'subdomains', label: 'Subdomains', icon: Globe },
                { id: 'ports', label: 'Ports', icon: Search },
                { id: 'dirs', label: 'Directories', icon: FolderOpen }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="space-y-4 overflow-y-auto flex-1">
              {activeTab === 'subdomains' && (
                <form onSubmit={handleSubdomainScan} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Domain</label>
                    <input
                      type="text"
                      value={subdomainForm.domain}
                      onChange={(e) => setSubdomainForm({ ...subdomainForm, domain: e.target.value })}
                      placeholder="example.com"
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder-muted-foreground focus:ring-2 focus:ring-primary focus:border-transparent"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">Concurrency</label>
                      <input
                        type="number"
                        value={subdomainForm.concurrency}
                        onChange={(e) => setSubdomainForm({ ...subdomainForm, concurrency: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground"
                        min="1"
                        max="1000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">Timeout (s)</label>
                      <input
                        type="number"
                        value={subdomainForm.timeout}
                        onChange={(e) => setSubdomainForm({ ...subdomainForm, timeout: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground"
                        min="1"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Custom Resolvers (optional)</label>
                    <input
                      type="text"
                      value={subdomainForm.resolvers}
                      onChange={(e) => setSubdomainForm({ ...subdomainForm, resolvers: e.target.value })}
                      placeholder="8.8.8.8,1.1.1.1"
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder-muted-foreground"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="subdomain-use-resolvers-file"
                      checked={(subdomainForm as any).useResolversFile}
                      onChange={(e) => setSubdomainForm({ ...subdomainForm, useResolversFile: e.target.checked })}
                      className="w-4 h-4 text-primary bg-input border-border rounded focus:ring-primary"
                    />
                    <label htmlFor="subdomain-use-resolvers-file" className="text-sm text-foreground">
                      Use resolvers file (.txt)
                    </label>
                  </div>
                  {(subdomainForm as any).useResolversFile && (
                    <div>
                      <input id="subdomain-resolvers-file" type="file" accept=".txt,.lst" className="w-full text-sm" />
                      <p className="text-xs text-muted-foreground mt-1">One IP or resolver per line</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="subdomain-auth"
                      checked={subdomainForm.authorized}
                      onChange={(e) => setSubdomainForm({ ...subdomainForm, authorized: e.target.checked })}
                      className="w-4 h-4 text-primary bg-input border-border rounded focus:ring-primary"
                    />
                    <label htmlFor="subdomain-auth" className="text-sm text-foreground">
                      I have authorization to scan this target
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={!subdomainForm.domain || !subdomainForm.authorized}
                    className="w-full py-2 px-4 bg-gradient-primary text-primary-foreground font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-glow transition-all"
                  >
                    <Play className="w-4 h-4 inline mr-2" />
                    Start Subdomain Scan
                  </button>
                  <p className="text-xs text-muted-foreground">Outputs: <code>{`{subdomain, resolved_ips, first_seen, last_seen}`}</code></p>
                </form>
              )}

              {activeTab === 'ports' && (
                <form onSubmit={handlePortScan} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Targets</label>
                    <textarea
                      value={portForm.targets}
                      onChange={(e) => setPortForm({ ...portForm, targets: e.target.value })}
                      placeholder="192.168.1.1,10.0.0.0/24,example.com"
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder-muted-foreground focus:ring-2 focus:ring-primary focus:border-transparent"
                      rows={3}
                      required
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="ports-use-targets-file"
                      checked={(portForm as any).useTargetsFile}
                      onChange={(e) => setPortForm({ ...portForm, useTargetsFile: e.target.checked })}
                      className="w-4 h-4 text-primary bg-input border-border rounded focus:ring-primary"
                    />
                    <label htmlFor="ports-use-targets-file" className="text-sm text-foreground">Use targets file (.txt)</label>
                  </div>
                  {(portForm as any).useTargetsFile && (
                    <div>
                      <input id="port-targets-file" type="file" accept=".txt,.lst" className="w-full text-sm" />
                      <p className="text-xs text-muted-foreground mt-1">Targets separated by newline or comma</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Ports</label>
                    <input
                      type="text"
                      value={portForm.ports}
                      onChange={(e) => setPortForm({ ...portForm, ports: e.target.value })}
                      placeholder="80,443,8080,8443"
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder-muted-foreground"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="ports-use-ports-file"
                      checked={(portForm as any).usePortsFile}
                      onChange={(e) => setPortForm({ ...portForm, usePortsFile: e.target.checked })}
                      className="w-4 h-4 text-primary bg-input border-border rounded focus:ring-primary"
                    />
                    <label htmlFor="ports-use-ports-file" className="text-sm text-foreground">Use ports file (.txt)</label>
                  </div>
                  {(portForm as any).usePortsFile && (
                    <div>
                      <input id="port-ports-file" type="file" accept=".txt,.lst" className="w-full text-sm" />
                      <p className="text-xs text-muted-foreground mt-1">Ports separated by newline or comma</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Timeout (s)</label>
                    <input
                      type="number"
                      value={portForm.timeout}
                      onChange={(e) => setPortForm({ ...portForm, timeout: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground"
                      min="1"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="port-auth"
                      checked={portForm.authorized}
                      onChange={(e) => setPortForm({ ...portForm, authorized: e.target.checked })}
                      className="w-4 h-4 text-primary bg-input border-border rounded focus:ring-primary"
                    />
                    <label htmlFor="port-auth" className="text-sm text-foreground">
                      I have authorization to scan these targets
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={!portForm.targets || !portForm.authorized}
                    className="w-full py-2 px-4 bg-gradient-primary text-primary-foreground font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-glow transition-all"
                  >
                    <Play className="w-4 h-4 inline mr-2" />
                    Start Port Scan
                  </button>
                  <p className="text-xs text-muted-foreground">Outputs: <code>{`{target, port, status, banner?}`}</code></p>
                </form>
              )}

              {activeTab === 'dirs' && (
                <form onSubmit={handleDirScan} className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">Preset</label>
                      <select
                        value={(dirForm as any).preset}
                        onChange={(e) => {
                          const v = e.target.value as 'Safe' | 'Standard' | 'Aggressive';
                          const presets = {
                            Safe: { timeout: 10, retries: 2, qps_per_host: '1' },
                            Standard: { timeout: 10, retries: 1, qps_per_host: '3' },
                            Aggressive: { timeout: 8, retries: 0, qps_per_host: '6' },
                          } as const;
                          const p = presets[v];
                          setDirForm({ ...dirForm, preset: v, timeout: p.timeout, retries: p.retries, qps_per_host: p.qps_per_host });
                        }}
                        className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground"
                      >
                        <option>Safe</option>
                        <option>Standard</option>
                        <option>Aggressive</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">Retries</label>
                      <input
                        type="number"
                        min={0}
                        max={5}
                        value={(dirForm as any).retries}
                        onChange={(e) => setDirForm({ ...dirForm, retries: Math.max(0, parseInt(e.target.value || '0')) })}
                        className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">Per-host QPS</label>
                      <input
                        type="number"
                        step="0.1"
                        min={0}
                        value={(dirForm as any).qps_per_host}
                        onChange={(e) => setDirForm({ ...dirForm, qps_per_host: e.target.value })}
                        placeholder="e.g. 3 (req/s)"
                        className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Base URL</label>
                    <input
                      type="url"
                      value={dirForm.base_url}
                      onChange={(e) => setDirForm({ ...dirForm, base_url: e.target.value })}
                      placeholder="https://example.com"
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder-muted-foreground focus:ring-2 focus:ring-primary focus:border-transparent"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Extensions</label>
                    <input
                      type="text"
                      value={dirForm.extensions}
                      onChange={(e) => setDirForm({ ...dirForm, extensions: e.target.value })}
                      placeholder="php,html,js,txt"
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder-muted-foreground"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Timeout (s)</label>
                    <input
                      type="number"
                      value={dirForm.timeout}
                      onChange={(e) => setDirForm({ ...dirForm, timeout: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground"
                      min="1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Status Codes (comma or newline)</label>
                    <textarea
                      value={(dirForm as any).status_include}
                      onChange={(e) => setDirForm({ ...dirForm, status_include: e.target.value })}
                      placeholder="200,204,301,302,403"
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder-muted-foreground"
                      rows={2}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Auth Header (optional)</label>
                    <input
                      type="text"
                      value={(dirForm as any).auth}
                      onChange={(e) => setDirForm({ ...dirForm, auth: e.target.value })}
                      placeholder="Authorization: Bearer <token>"
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder-muted-foreground"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Proxies (JSON or URL)</label>
                    <input
                      type="text"
                      value={(dirForm as any).proxies}
                      onChange={(e) => setDirForm({ ...dirForm, proxies: e.target.value })}
                      placeholder='{"http":"http://127.0.0.1:8080","https":"http://127.0.0.1:8080"} or http://127.0.0.1:8080'
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder-muted-foreground"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="dir-use-upload"
                      checked={(dirForm as any).useUpload}
                      onChange={(e) => setDirForm({ ...dirForm, useUpload: e.target.checked })}
                      className="w-4 h-4 text-primary bg-input border-border rounded focus:ring-primary"
                    />
                    <label htmlFor="dir-use-upload" className="text-sm text-foreground">Use custom wordlist file</label>
                  </div>
                  {(dirForm as any).useUpload ? (
                    <div>
                      <input id="dir-wordlist-file" type="file" accept=".txt,.lst" className="w-full text-sm" />
                      <p className="text-xs text-muted-foreground mt-1">One entry per line</p>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">Wordlist (one per line, optional)</label>
                      <textarea
                        value={(dirForm as any).wordlistText}
                        onChange={(e) => setDirForm({ ...dirForm, wordlistText: e.target.value })}
                        placeholder="admin\nlogin\nbackup"
                        className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder-muted-foreground"
                        rows={4}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="dir-auth"
                      checked={dirForm.authorized}
                      onChange={(e) => setDirForm({ ...dirForm, authorized: e.target.checked })}
                      className="w-4 h-4 text-primary bg-input border-border rounded focus:ring-primary"
                    />
                    <label htmlFor="dir-auth" className="text-sm text-foreground">
                      I have authorization to scan this target
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={!dirForm.base_url || !dirForm.authorized}
                    className="w-full py-2 px-4 bg-gradient-primary text-primary-foreground font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-glow transition-all"
                  >
                    <Play className="w-4 h-4 inline mr-2" />
                    Start Directory Scan
                  </button>
                  <p className="text-xs text-muted-foreground">Outputs: <code>{`{url, status, length, title, content_type, redirected_to?}`}</code></p>
                </form>
              )}
            </div>
          </div>

          {/* Right panel: Jobs / Results */}
          <div className="bg-gradient-card rounded-lg border border-border shadow-card p-4 flex flex-col">
            <div className="flex items-center gap-3 mb-4 overflow-x-auto whitespace-nowrap">
              <div className="flex border-b border-border shrink-0">
                {['jobs','results','report'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setRightPanelTab(t as 'jobs' | 'results' | 'report')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 ${
                      rightPanelTab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t === 'jobs' ? 'Recent Jobs' : t === 'results' ? 'Results' : 'Report'}
                  </button>
                ))}
              </div>
              {rightPanelTab === 'results' && (
                <div className="flex gap-1 shrink-0">
                  {[
                    { id: 'subdomains', label: 'Subdomains' },
                    { id: 'ports', label: 'Ports' },
                    { id: 'dirs', label: 'Directories' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setResultsTab(tab.id as any)}
                      className={`px-3 py-1 text-xs font-medium rounded ${
                        resultsTab === tab.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
              {/* Report controls moved below */}
            </div>

            {rightPanelTab === 'report' && (
              <div className="mb-3">
                <div className="flex items-center gap-2 flex-nowrap overflow-x-auto whitespace-nowrap">
                  <select
                    value={reportType}
                    onChange={(e) => {
                      setReportType(e.target.value as any);
                      setReportJobId('');
                    }}
                    className="px-3 py-1.5 text-sm bg-input border border-border rounded-md text-foreground w-44"
                  >
                    <option value="dirs">Directories</option>
                    <option value="ports">Ports</option>
                    <option value="subdomains">Subdomains</option>
                  </select>
                  <select
                    value={reportJobId}
                    onChange={(e) => setReportJobId(e.target.value)}
                    className="px-3 py-1.5 text-sm bg-input border border-border rounded-md text-foreground min-w-[16rem] w-[26rem] max-w-full"
                  >
                    <option value="">Select job…</option>
                    {jobs.filter(j => j.type === reportType).map((j) => (
                      <option key={j.id} value={j.id}>{formatJobLabel(j)}</option>
                    ))}
                  </select>
                  <button
                    disabled={!reportJobId}
                    onClick={() => {
                      const job = jobs.find(j => String(j.id) === String(reportJobId));
                      if (job) exportPDF(job);
                    }}
                    className="px-3 py-1.5 text-xs rounded bg-secondary text-foreground border border-border disabled:opacity-50"
                  >PDF</button>
                  <button
                    disabled={!reportJobId}
                    onClick={() => {
                      const job = jobs.find(j => String(j.id) === String(reportJobId));
                      if (job) exportTXT(job);
                    }}
                    className="px-3 py-1.5 text-xs rounded bg-secondary text-foreground border border-border disabled:opacity-50"
                  >TXT</button>
                  <button
                    disabled={!reportJobId}
                    onClick={() => {
                      const job = jobs.find(j => String(j.id) === String(reportJobId));
                      if (job) exportDOCX(job);
                    }}
                    className="px-3 py-1.5 text-xs rounded bg-secondary text-foreground border border-border disabled:opacity-50"
                  >DOCX</button>
                </div>
              </div>
            )}

            {rightPanelTab !== 'report' && (
            <div className="overflow-y-auto flex-1">
              <div className="space-y-3">
                {(rightPanelTab === 'jobs' ? jobs : jobs.filter(j => j.type === resultsTab)).map((job) => (
                  <div key={job.id} className="bg-secondary/50 rounded-lg p-3 border border-border hover:bg-card-hover transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className={getStatusBadge(job.state, job.progress)}>
                          {job.state}
                        </span>
                        <span className="text-sm font-medium text-foreground capitalize">
                          {job.type}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            activeJobIdRef.current = job.id;
                            setSelectedJob(job);
                          }}
                          className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {rightPanelTab === 'jobs' && job.state === 'running' && (
                          <button
                            onClick={() => handleJobAction(job.id, 'pause')}
                            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-warning transition-colors"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        )}
                        {rightPanelTab === 'jobs' && job.state === 'paused' && (
                          <button
                            onClick={() => handleJobAction(job.id, 'resume')}
                            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-success transition-colors"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        {rightPanelTab === 'jobs' && (job.state === 'running' || job.state === 'paused') && (
                          <button
                            onClick={() => handleJobAction(job.id, 'cancel')}
                            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Square className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteJob(job.id)}
                          className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <a
                          href={api(`/jobs/${job.id}/export.csv`)}
                          download
                          className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                    
                    <div className="mb-2">
                      <div className="text-xs text-muted-foreground mb-1">
                        Progress: {job.progress.toFixed(1)}%
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${
                            job.state === 'completed' ? 'bg-gradient-success' :
                            job.state === 'cancelled' ? 'bg-status-cancelled' :
                            job.state === 'failed' ? 'bg-destructive' :
                            'bg-gradient-primary'
                          }`}
                          style={{ width: `${Math.min(job.progress, 100)}%` }}
                        />
                      </div>
                    </div>
                    
                    <div className="text-xs text-muted-foreground">
                      {job.domain && <div>Domain: {job.domain}</div>}
                      {job.targets && <div>Targets: {job.targets.join(', ')}</div>}
                      {job.base_url && <div>URL: {job.base_url}</div>}
                      <div>Created: {formatDateTime(job.created_at)}</div>
                    </div>
                  </div>
                ))}
                
                {(rightPanelTab === 'jobs' ? jobs : jobs.filter(j => j.type === resultsTab)).length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    {rightPanelTab === 'jobs' ? 'No jobs found. Start a scan to see jobs here.' : 'No results jobs for this type yet.'}
                  </div>
                )}
              </div>
            </div>
            )}
            {rightPanelTab === 'report' && (
              <div className="text-xs text-muted-foreground mt-2">
                Choose a type and job, then export the report as PDF, TXT, or DOCX. The report includes job metadata and a table of findings.
              </div>
            )}
          </div>
        </div>
        {/* Job Details Modal/Panel */}
        {selectedJob && (
          <JobDetailsModal
            key={selectedJob.id}
            jobId={selectedJob.id}
            initial={selectedJob}
            onClose={() => {
              activeJobIdRef.current = null;
              setSelectedJob(null);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default Dashboard;