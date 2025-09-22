import React, { useEffect, useMemo, useState } from 'react'

const RAW_API_BASE = (import.meta as any)?.env?.VITE_API_BASE_URL as string | undefined
const API_BASE = RAW_API_BASE && /^https?:\/\//i.test(RAW_API_BASE) ? RAW_API_BASE : ''
const api = (path: string) => (API_BASE ? `${API_BASE.replace(/\/$/, '')}${path}` : path)

type Tab = 'Subdomains' | 'Ports' | 'Directories'

function useMetrics() {
  const [data, setData] = useState<{findings_total:number; findings_per_min:number} | null>(null)
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch(api('/api/metrics'))
        if (r.ok) setData(await r.json())
        else setData(null)
      } catch {}
    }, 3000)
    return () => clearInterval(id)
  }, [])
  return data
}

function useBackendHealth() {
  const [online, setOnline] = useState<boolean>(false)
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(api('/healthz'))
        setOnline(r.ok)
      } catch { setOnline(false) }
    }
    check()
    const id = setInterval(check, 3000)
    return () => clearInterval(id)
  }, [])
  return online
}

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('Subdomains')
  const metrics = useMetrics()
  const [selected, setSelected] = useState<{id:number; type:string} | null>(null)
  const backendOnline = useBackendHealth()
  return (
    <div>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16}}>
        <h2 style={{margin:0, letterSpacing:.5}}>⚡ ReconX</h2>
        <div className="badge" title={backendOnline? 'Backend API reachable' : 'Backend API not reachable'}>
          <span style={{display:'inline-block', width:10, height:10, borderRadius:5, background: backendOnline? 'var(--accent)':'var(--danger)'}}></span>
          Backend: {backendOnline? 'Online':'Offline'}
        </div>
      </div>
      <div className="kpi">
        <div className="card"><div style={{fontSize:12,color:'var(--muted)'}}>Total Findings</div><div style={{fontSize:24,fontWeight:700}}>{metrics?.findings_total ?? 0}</div></div>
        <div className="card"><div style={{fontSize:12,color:'var(--muted)'}}>Rate</div><div style={{fontSize:24,fontWeight:700}}>{(metrics?.findings_per_min ?? 0).toFixed(2)}/min</div></div>
      </div>
      <JobsList onSelect={(j)=>setSelected({id:j.id, type:j.type})} />
      {selected && (
        <div className="card" style={{margin:'12px 0'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <h4 style={{margin:0}}>Job #{selected.id} • {selected.type}</h4>
            <button onClick={()=>setSelected(null)}>Close</button>
          </div>
          <JobDetails jobId={selected.id} jobType={selected.type as any} />
        </div>
      )}
      <div style={{display:'flex', gap:8, marginBottom:12}}>
        {(['Subdomains','Ports','Directories'] as Tab[]).map(t => (
          <button key={t} onClick={()=>setTab(t)} disabled={t===tab} style={{opacity:t===tab?0.7:1}}>{t}</button>
        ))}
      </div>
  {tab==='Subdomains' && <SubdomainsTab onJobCreated={(j)=>setSelected({id:j.job_id, type:'subdomains'})}/>}
  {tab==='Ports' && <PortsTab onJobCreated={(j)=>setSelected({id:j.job_id, type:'ports'})}/>}
  {tab==='Directories' && <DirsTab onJobCreated={(j)=>setSelected({id:j.job_id, type:'dirs'})}/>}
    </div>
  )
}

function SubdomainsTab({onJobCreated}:{onJobCreated:(job:{job_id:number})=>void}){
  return (
    <section>
      <NewScan kind="subdomains" onJobCreated={onJobCreated}/>
    </section>
  )
}
function PortsTab({onJobCreated}:{onJobCreated:(job:{job_id:number})=>void}){
  return (
    <section>
      <NewScan kind="ports" onJobCreated={onJobCreated}/>
    </section>
  )
}
function DirsTab({onJobCreated}:{onJobCreated:(job:{job_id:number})=>void}){
  return (
    <section>
      <NewScan kind="dirs" onJobCreated={onJobCreated}/>
    </section>
  )
}

type Kind = 'subdomains'|'ports'|'dirs'

function NewScan({kind, onJobCreated}:{kind:Kind; onJobCreated:(job:{job_id:number})=>void}){
  const [form, setForm] = useState<any>({authorized:false, project:'default', useUpload:false, wordlistText:'', status_include:'', extensions:''})
  const [resp, setResp] = useState<any>(null)
  const [err, setErr] = useState<string|undefined>()
  const [submitting, setSubmitting] = useState(false)
  const applyPreset = (name:'Safe'|'Standard'|'Aggressive') => {
    const p: any = { authorized: form.authorized }
    if (kind==='subdomains') {
      if (name==='Safe') Object.assign(p, { concurrency: 25, timeout: 20 })
      if (name==='Standard') Object.assign(p, { concurrency: 50, timeout: 30 })
      if (name==='Aggressive') Object.assign(p, { concurrency: 150, timeout: 45 })
    }
    if (kind==='ports') {
      if (name==='Safe') Object.assign(p, { ports: [80,443,22], timeout: 2 })
      if (name==='Standard') Object.assign(p, { ports: [80,443,22,3389,8080,8443], timeout: 5 })
      if (name==='Aggressive') Object.assign(p, { ports: [80,443,22,3389,8080,8443,53,25,110,143], timeout: 3 })
    }
    if (kind==='dirs') {
      if (name==='Safe') Object.assign(p, { timeout: 10 })
      if (name==='Standard') Object.assign(p, { timeout: 15 })
      if (name==='Aggressive') Object.assign(p, { timeout: 20 })
    }
    setForm({ ...form, ...p })
  }
  const submit = async ()=>{
    setErr(undefined); setSubmitting(true)
    try{
      if (kind==='dirs' && form.useUpload) {
        const fileInput = document.getElementById('dir-wordlist-file') as HTMLInputElement | null
        if (!fileInput || !fileInput.files || fileInput.files.length===0) throw new Error('Choose a wordlist file')
        const fd = new FormData()
        fd.append('base_url', form.base_url||'')
        fd.append('authorized', String(!!form.authorized))
        fd.append('timeout', String(form.timeout ?? 10))
        fd.append('project', form.project||'default')
        if (form.status_include) fd.append('status_include', String(form.status_include))
        if (form.extensions) fd.append('extensions', String(form.extensions))
        fd.append('wordlist_file', fileInput.files[0])
        const r = await fetch(api('/api/recon/dirs/scan/upload'), { method:'POST', body: fd })
        const data = await r.json().catch(()=>({}))
        if(!r.ok){ setErr((data as any)?.detail || 'Failed to start'); setResp(undefined); return }
        setResp(data)
        if((data as any)?.job_id){ onJobCreated({job_id: (data as any).job_id}) }
      } else {
        const payload: any = { ...form }
        if (kind==='dirs') {
          if (form.wordlistText) payload.wordlist = String(form.wordlistText).split(/\r?\n/).map((s:string)=>s.trim()).filter(Boolean)
          if (form.status_include) payload.status_include = String(form.status_include)
          if (form.extensions) payload.extensions = String(form.extensions)
        }
        const url = api(`/api/recon/${kind}/scan`)
        const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)})
        const data = await r.json().catch(()=>({}))
        if(!r.ok){ setErr((data as any)?.detail || 'Failed to start'); setResp(undefined); return }
        setResp(data)
        if((data as any)?.job_id){ onJobCreated({job_id: (data as any).job_id}) }
      }
    }catch(e:any){ setErr(e?.message || 'Network error') }
    finally{ setSubmitting(false) }
  }
  const valid = form.authorized && ((kind==='subdomains' && !!form.domain) || (kind==='ports' && Array.isArray(form.targets) && form.targets.length>0) || (kind==='dirs' && !!form.base_url))
  return (
    <div className="card">
      <h4 style={{marginTop:0}}>New {kind} scan</h4>
      <div style={{fontSize:12, color:'var(--muted)', marginBottom:8}}>Provide required fields and confirm authorization to enable Start.</div>
      <div style={{marginBottom:8}}>
        <label><input type="checkbox" checked={!!form.authorized} onChange={e=>setForm({...form, authorized:e.target.checked})}/> I have authorization</label>
      </div>
      <div style={{margin:'6px 0'}}>
        Presets:
        <button onClick={()=>applyPreset('Safe')}>Safe</button>
        <button onClick={()=>applyPreset('Standard')}>Standard</button>
        <button onClick={()=>applyPreset('Aggressive')}>Aggressive</button>
      </div>
      {kind==='subdomains' && (
        <div>
          <label style={{display:'block', fontSize:12, color:'#555'}}>Domain</label>
          <input placeholder="example.com" onChange={e=>setForm({...form, domain:e.target.value})} style={{width:'100%'}}/>
        </div>
      )}
      {kind==='ports' && (
        <div>
          <label style={{display:'block', fontSize:12, color:'#555'}}>Targets (comma-separated)</label>
          <input placeholder="1.1.1.1,example.com" onChange={e=>setForm({...form, targets:e.target.value.split(',').map((s:string)=>s.trim()).filter(Boolean)})} style={{width:'100%'}}/>
        </div>
      )}
      {kind==='dirs' && (
        <div>
          <label style={{display:'block', fontSize:12, color:'#555'}}>Base URL</label>
          <input placeholder="https://example.com" onChange={e=>setForm({...form, base_url:e.target.value})} style={{width:'100%'}}/>
          <div style={{marginTop:8}}>
            <label style={{display:'block', fontSize:12, color:'#555'}}>Extensions (comma-separated, optional)</label>
            <input placeholder="php,html,js,txt" value={form.extensions||''} onChange={e=>setForm({...form, extensions:e.target.value})} style={{width:'100%'}}/>
          </div>
          <div style={{marginTop:8}}>
            <label style={{display:'block', fontSize:12, color:'#555'}}>Status Codes (comma/newline, optional)</label>
            <textarea placeholder="200,204,301,302,403" value={form.status_include||''} onChange={e=>setForm({...form, status_include:e.target.value})} style={{width:'100%'}} rows={2}/>
          </div>
          <div style={{marginTop:8, display:'flex', alignItems:'center', gap:6}}>
            <input id="dir-use-upload" type="checkbox" checked={!!form.useUpload} onChange={e=>setForm({...form, useUpload:e.target.checked})} />
            <label htmlFor="dir-use-upload" style={{fontSize:12}}>Use custom wordlist file</label>
          </div>
          {form.useUpload ? (
            <div style={{marginTop:6}}>
              <input id="dir-wordlist-file" type="file" accept=".txt,.lst" />
              <div style={{fontSize:11, color:'var(--muted)', marginTop:4}}>One entry per line</div>
            </div>
          ) : (
            <div style={{marginTop:6}}>
              <label style={{display:'block', fontSize:12, color:'#555'}}>Wordlist (one per line, optional)</label>
              <textarea placeholder={"admin\nlogin\nbackup"} value={form.wordlistText||''} onChange={e=>setForm({...form, wordlistText:e.target.value})} style={{width:'100%'}} rows={4}/>
            </div>
          )}
        </div>
      )}
      <div style={{marginTop:8, display:'flex', alignItems:'center', gap:8}}>
        <button onClick={submit} disabled={!valid || submitting}>
          {submitting? 'Starting...':'Start Scan'}
        </button>
        {!valid && <span style={{fontSize:12, color:'var(--muted)'}}>Fill required fields and authorize</span>}
      </div>
      {err && <div style={{marginTop:8, color:'var(--danger)'}}>Error: {err}</div>}
      {resp && <div style={{marginTop:8, color:'var(--accent)'}}>Started job #{resp.job_id}</div>}
    </div>
  )
}

function JobsList({onSelect}:{onSelect:(job:any)=>void}){
  const [jobs, setJobs] = useState<any[]>([])
  const refresh = async () => {
    try{ const r = await fetch(api('/api/jobs')); if(r.ok) setJobs(await r.json()) }catch{}
  }
  useEffect(()=>{
    const id = setInterval(refresh, 3000)
    refresh()
    return ()=>clearInterval(id)
  }, [])
  const act = async (id:number, op:'pause'|'resume'|'cancel') => {
    await fetch(api(`/api/jobs/${id}/${op}`), {method:'POST'})
    await refresh()
  }
  const removeJob = async (id:number) => {
    await fetch(api(`/api/jobs/${id}`), {method:'DELETE'})
    // force refresh
    try{ const r = await fetch(api('/api/jobs')); if(r.ok) setJobs(await r.json()) }catch{}
  }
  return (
    <div style={{margin:'12px 0'}}>
      <h4>Recent Jobs</h4>
      <table className="table">
        <thead><tr><th>ID</th><th>Type</th><th>State</th><th>Progress</th><th>Actions</th></tr></thead>
        <tbody>
          {jobs.map((j:any)=> (
            <tr key={j.id}>
              <td>{j.id}</td>
              <td>{j.type}</td>
              <td>{j.state}</td>
              <td><div className="progress" style={{width:140}}><span style={{width:`${j.progress||0}%`}}></span></div> {j.progress||0}%</td>
              <td>
                <button onClick={()=>onSelect(j)}>View</button>
                <button onClick={()=>act(j.id,'pause')}>Pause</button>
                <button onClick={()=>act(j.id,'resume')}>Resume</button>
                <button onClick={()=>act(j.id,'cancel')}>Cancel</button>
                <button onClick={()=>removeJob(j.id)}>Delete</button>
                <a href={api(`/api/jobs/${j.id}/export.csv`)} style={{marginLeft:6}}>CSV</a>
                <a href={api(`/api/jobs/${j.id}/export.json`)} style={{marginLeft:6}}>JSON</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JobDetails({jobId, jobType}:{jobId:number; jobType:Kind}){
  const [status, setStatus] = useState<{state:string; progress:number}|null>(null)
  const [findings, setFindings] = useState<any[]>([])
  useEffect(()=>{
    let mounted = true
    const tick = async () => {
      try {
        const [s, f] = await Promise.all([
          fetch(api(`/api/jobs/${jobId}`)),
          fetch(api(`/api/jobs/${jobId}/findings`))
        ])
        if (mounted) {
          if (s.ok) setStatus(await s.json())
          if (f.ok) setFindings(await f.json())
        }
      } catch {}
    }
    tick()
    const id = setInterval(tick, 3000)
    return ()=>{ mounted=false; clearInterval(id) }
  }, [jobId])

  return (
    <div>
      <div style={{marginBottom:8}}>State: {status?.state||'n/a'} • Progress: {status?.progress||0}% • Findings: {findings.length}</div>
      <div className="card" style={{maxHeight:300, overflow:'auto'}}>
        <table className="table" style={{width:'100%'}}>
          {jobType==='subdomains' && (
            <>
              <thead><tr><th>Subdomain</th><th>IPs</th><th>First Seen</th><th>Last Seen</th></tr></thead>
              <tbody>
                {findings.map((f:any, i:number)=> (
                  <tr key={i}><td>{f.subdomain}</td><td>{(f.resolved_ips||[]).join(', ')}</td><td>{f.first_seen}</td><td>{f.last_seen}</td></tr>
                ))}
              </tbody>
            </>
          )}
          {jobType==='ports' && (
            <>
              <thead><tr><th>Target</th><th>Port</th><th>Status</th><th>Banner</th></tr></thead>
              <tbody>
                {findings.map((f:any, i:number)=> (
                  <tr key={i}><td>{f.target}</td><td>{f.port}</td><td>{f.status}</td><td>{f.banner||''}</td></tr>
                ))}
              </tbody>
            </>
          )}
          {jobType==='dirs' && (
            <>
              <thead><tr><th>URL</th><th>Status</th><th>Length</th><th>Title</th></tr></thead>
              <tbody>
                {findings.map((f:any, i:number)=> (
                  <tr key={i}><td>{f.url}</td><td>{f.status}</td><td>{f.length}</td><td>{f.title||''}</td></tr>
                ))}
              </tbody>
            </>
          )}
        </table>
      </div>
    </div>
  )
}
