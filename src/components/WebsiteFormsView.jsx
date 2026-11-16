import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Globe,
  Plus,
  Trash2,
  Copy,
  Check,
  X,
  Code,
  RefreshCw,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Server,
  Zap,
  Send,
  Terminal,
  ShieldCheck,
  AlertCircle,
  GitBranch,
  Layers,
  Sparkles
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getActiveCompanyId } from '../lib/tenant';
import Skeleton from './common/Skeleton';
import '../styles/meta.css';
import '../styles/pipeline.css';

export default function WebsiteFormsView({ currentUser }) {
  const [forms, setForms] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [newFormName, setNewFormName] = useState('');
  const [newFormPipelineId, setNewFormPipelineId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [selectedScriptForm, setSelectedScriptForm] = useState(null);
  const [scriptTab, setScriptTab] = useState('passive'); // 'passive' | 'server' | 'abandonment' | 'curl'
  const [scriptCopied, setScriptCopied] = useState(false);
  const [isTestingLead, setIsTestingLead] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

  // Fetch website forms and pipelines
  const fetchData = async () => {
    const companyId = getActiveCompanyId();
    if (!companyId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [formsRes, pipesRes] = await Promise.all([
        supabase
          .from('connected_forms')
          .select('*')
          .eq('company_id', companyId)
          .eq('source', 'website')
          .order('created_at', { ascending: false }),
        supabase
          .from('pipelines')
          .select('id, name')
          .eq('company_id', companyId)
      ]);

      if (formsRes.data) setForms(formsRes.data);
      if (pipesRes.data) {
        setPipelines(pipesRes.data);
        if (pipesRes.data.length > 0 && !newFormPipelineId) {
          setNewFormPipelineId(pipesRes.data[0].id);
        }
      }
    } catch (err) {
      console.warn('Error loading website forms:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateForm = async (e) => {
    e.preventDefault();
    const name = newFormName.trim();
    if (!name || isCreating) return;

    setIsCreating(true);
    try {
      const companyId = getActiveCompanyId();
      if (!companyId) {
        throw new Error('No active workspace selected.');
      }
      const uniqueId = `wf_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
      const targetPipelineId = newFormPipelineId || (pipelines[0]?.id || null);

      const payload = {
        company_id: companyId,
        form_id: uniqueId,
        form_name: name,
        source: 'website',
        pipeline_id: targetPipelineId,
        entry_stage_id: 'new',
        allocation_mode: 'inherit_global',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('connected_forms')
        .insert([payload])
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setForms((prev) => [data, ...prev]);
      }
      setNewFormName('');
      setIsModalOpen(false);
    } catch (err) {
      console.error('Failed to create website form:', err);
      alert('Failed to create form: ' + (err.message || 'Unknown error'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateFormPipeline = async (formId, pipelineId) => {
    const companyId = getActiveCompanyId();
    if (!companyId) return;
    try {
      await supabase
        .from('connected_forms')
        .update({
          pipeline_id: pipelineId || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', formId)
        .eq('company_id', companyId);

      setForms((prev) =>
        prev.map((f) => (f.id === formId ? { ...f, pipeline_id: pipelineId } : f))
      );
    } catch (err) {
      console.error('Failed to update form pipeline:', err);
      alert('Could not update pipeline: ' + (err.message || 'Unknown error'));
    }
  };

  const handleDeleteForm = async (form) => {
    if (!window.confirm(`Delete "${form.form_name}"? Existing leads will remain unchanged.`)) return;

    try {
      const companyId = getActiveCompanyId();
      if (!companyId) throw new Error('No active workspace selected.');
      await supabase
        .from('connected_forms')
        .delete()
        .eq('id', form.id)
        .eq('company_id', companyId);

      setForms((prev) => prev.filter((f) => f.id !== form.id));
      if (selectedScriptForm?.id === form.id) {
        setSelectedScriptForm(null);
      }
    } catch (err) {
      console.error('Failed to delete website form:', err);
      alert('Could not delete form: ' + (err.message || 'Unknown error'));
    }
  };

  const getPassiveScript = (formId) => {
    const endpoint = `${supabaseUrl}/functions/v1/website-webhook?form_id=${formId}`;
    return `<!-- simplecrm Universal Form Interceptor -->
<!-- Safe for all checkout, payment, Webflow, and custom HTML forms -->
<script>
(function() {
  var crmEndpoint = '${endpoint}';

  // Passive interceptor: captures data silently without stopping submit, redirects, or checkout
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form || form.nodeName !== 'FORM') return;

    try {
      var formData = new FormData(form);
      var data = Object.fromEntries(formData.entries());

      data.site_domain = window.location.hostname;
      data.page_url = window.location.href;

      // Automatically capture UTM parameters from URL for ad attribution
      var params = new URLSearchParams(window.location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function(k) {
        if (params.get(k)) data[k] = params.get(k);
      });

      var jsonPayload = JSON.stringify(data);

      // Transmit silently using keepalive/sendBeacon (guarantees delivery across payment redirects)
      if (navigator.sendBeacon) {
        navigator.sendBeacon(crmEndpoint, new Blob([jsonPayload], { type: 'application/json' }));
      } else {
        fetch(crmEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonPayload,
          keepalive: true
        }).catch(function() {});
      }
    } catch (err) {}
  }, true);
})();
</script>`;
  };

  const getServerScript = (formId) => {
    const endpoint = `${supabaseUrl}/functions/v1/website-webhook?form_id=${formId}`;
    return `// Server-Side Webhook (e.g. Next.js API route, Server Action, Express, or Checkout handler)
// 100% Ad-blocker immune & runs asynchronously before payment gateway opens

async function forwardLeadToCrm(customerData, utmParams = {}) {
  const endpoint = '${endpoint}';

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_domain: 'yourwebsite.com',
        name: customerData.name || customerData.fullName,
        email: customerData.email,
        phone: customerData.phone,
        city: customerData.city || '',
        notes: customerData.notes || 'Checkout initiated',
        utm_source: utmParams.utm_source || utmParams.source || '',
        utm_medium: utmParams.utm_medium || utmParams.medium || '',
        utm_campaign: utmParams.utm_campaign || utmParams.campaign || '',
        updates_consent: customerData.whatsappConsent || false
      })
    });
  } catch (err) {
    // Non-blocking: never fail customer checkout if CRM forward has a network delay
    console.warn('[simplecrm] Lead forward notice:', err);
  }
}`;
  };

  const getAbandonmentScript = (formId) => {
    const endpoint = `${supabaseUrl}/functions/v1/website-webhook?form_id=${formId}`;
    return `<!-- simplecrm Pre-Payment / Drop-off Capture -->
<!-- Captures contact info the instant visitor enters email or phone and moves to the next field -->
<script>
(function() {
  var crmEndpoint = '${endpoint}';
  var captured = false;

  document.addEventListener('change', function(e) {
    if (captured) return;
    var el = e.target;
    if (!el || (el.type !== 'email' && el.name !== 'email' && el.name !== 'phone' && el.type !== 'tel')) return;

    var form = el.closest('form');
    if (!form) return;

    try {
      var data = Object.fromEntries(new FormData(form).entries());
      if (data.email || data.phone) {
        data.site_domain = window.location.hostname;
        data.notes = 'Pre-payment lead (captured on input)';

        var params = new URLSearchParams(window.location.search);
        ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function(k) {
          if (params.get(k)) data[k] = params.get(k);
        });

        if (navigator.sendBeacon) {
          navigator.sendBeacon(crmEndpoint, new Blob([JSON.stringify(data)], { type: 'application/json' }));
          captured = true;
        }
      }
    } catch (err) {}
  }, true);
})();
</script>`;
  };

  const getCurlScript = (formId) => {
    const endpoint = `${supabaseUrl}/functions/v1/website-webhook?form_id=${formId}`;
    return `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "site_domain": "yourwebsite.com",
    "name": "Alex Johnson",
    "email": "alex@example.com",
    "phone": "+91 9876543210",
    "city": "Mumbai",
    "utm_source": "meta_ads",
    "utm_campaign": "march_growth"
  }'`;
  };

  const getActiveCode = (formId) => {
    if (scriptTab === 'server') return getServerScript(formId);
    if (scriptTab === 'abandonment') return getAbandonmentScript(formId);
    if (scriptTab === 'curl') return getCurlScript(formId);
    return getPassiveScript(formId);
  };

  const handleCopyScript = () => {
    if (!selectedScriptForm) return;
    const script = getActiveCode(selectedScriptForm.form_id);
    navigator.clipboard.writeText(script);
    setScriptCopied(true);
    setTimeout(() => setScriptCopied(false), 2000);
  };

  const handleSendTestLead = async (form) => {
    setIsTestingLead(true);
    setTestResult(null);
    try {
      const endpoint = `${supabaseUrl}/functions/v1/website-webhook?form_id=${form.form_id}`;
      const payload = {
        name: 'Alex Johnson (Sample Lead)',
        email: 'alex.sample@example.com',
        phone: '+91 98765 43210',
        city: 'Mumbai',
        site_domain: window.location.hostname || 'simulator.local',
        utm_source: 'dashboard_test',
        utm_medium: 'crm_simulator',
        utm_campaign: 'lead_verification',
        notes: 'Verification test triggered from simplecrm Website Forms dashboard.'
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send test lead');
      }

      setTestResult({
        success: true,
        message: `Success! Test lead created (${data.lead_id ? data.lead_id.substring(0, 8) : 'new'}). Verified pipeline ingestion.`
      });
      fetchData();
    } catch (err) {
      setTestResult({
        success: false,
        message: err.message || 'Error communicating with webhook endpoint'
      });
    } finally {
      setIsTestingLead(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
        {/* Hero Card Skeleton */}
        <div className="meta-panel-card">
          <div className="meta-account-row">
            <div className="meta-account-identity">
              <Skeleton width="44px" height="44px" borderRadius="8px" />
              <div className="meta-account-details" style={{ gap: '6px' }}>
                <Skeleton width="190px" height="20px" borderRadius="4px" />
              </div>
            </div>
            <div className="meta-account-actions">
              <Skeleton width="110px" height="34px" borderRadius="7px" />
            </div>
          </div>
          <div className="meta-account-footer-row">
            <Skeleton width="220px" height="14px" borderRadius="4px" />
            <Skeleton width="60px" height="14px" borderRadius="4px" />
          </div>
        </div>

        {/* Forms Table Skeleton */}
        <div className="meta-panel-card">
          <div className="meta-panel-header">
            <div className="meta-panel-header-left">
              <Skeleton width="130px" height="18px" borderRadius="4px" />
              <Skeleton width="85px" height="20px" borderRadius="10px" />
            </div>
            <Skeleton width="96px" height="32px" borderRadius="6px" />
          </div>

          <div className="meta-forms-table">
            {[1, 2, 3].map((i) => (
              <div key={i} className="meta-form-row-item">
                <div className="meta-form-identity">
                  <Skeleton width="36px" height="36px" borderRadius="8px" />
                  <div className="meta-form-info-col" style={{ gap: '6px' }}>
                    <Skeleton width={i === 1 ? '140px' : (i === 2 ? '170px' : '120px')} height="15px" borderRadius="4px" />
                    <Skeleton width={i === 1 ? '110px' : (i === 2 ? '135px' : '100px')} height="14px" borderRadius="10px" />
                  </div>
                </div>
                <div className="meta-form-actions-col">
                  <Skeleton width="88px" height="30px" borderRadius="6px" />
                  <Skeleton width="30px" height="30px" borderRadius="6px" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
      {/* SECTION 1: HERO STATUS CARD */}
      <div className="meta-panel-card">
        <div className="meta-account-row">
          <div className="meta-account-identity">
            <div className="meta-brand-tile">
              <Globe size={22} color="#0f172a" />
            </div>
            <div className="meta-account-details">
              <div className="meta-account-title-line">
                <span className="meta-account-name">Universal Website Forms & Webhooks</span>
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                Capture leads from HTML forms, payment checkouts, React apps, and landing pages with zero disruption.
              </p>
            </div>
          </div>

          <div className="meta-account-actions">
            <button
              type="button"
              className="btn-meta-clean"
              onClick={() => {
                if (forms.length > 0) {
                  setSelectedScriptForm(forms[0]);
                  setScriptCopied(false);
                  setTestResult(null);
                } else {
                  setIsModalOpen(true);
                }
              }}
              style={{ height: '34px', padding: '0 12px', fontSize: '13px', gap: '6px' }}
            >
              <Code size={14} />
              <span>Get Integration Code</span>
            </button>
          </div>
        </div>

        <div className="meta-account-footer-row">
          <span className="meta-id-pill">
            Endpoint: <strong>{supabaseUrl ? `${supabaseUrl.replace(/^https?:\/\//, '')}/functions/v1/website-webhook` : 'Supabase Edge Functions'}</strong>
          </span>
          <span className="meta-connection-status">
            <span className="meta-status-dot is-connected" />
            Active
          </span>
        </div>
      </div>

      {/* SECTION 2: FORMS PANEL */}
      <div className="meta-panel-card">
        <div className="meta-panel-header">
          <div className="meta-panel-header-left">
            <span className="meta-panel-title">Connected Forms & Endpoints</span>
            <span className="meta-count-badge">
              {forms.length} {forms.length === 1 ? 'form' : 'forms'} configured
            </span>
          </div>

          <button
            type="button"
            className="btn-meta-add-form"
            onClick={() => {
              if (pipelines.length > 0 && !newFormPipelineId) {
                setNewFormPipelineId(pipelines[0].id);
              }
              setIsModalOpen(true);
            }}
          >
            <Plus size={14} /> Add Form
          </button>
        </div>

        {forms.length === 0 ? (
          <div className="meta-forms-empty-state">
            <Globe size={24} color="#94a3b8" />
            <p className="meta-empty-title">No website forms configured</p>
            <p style={{ margin: '4px 0 10px 0', fontSize: '12px', color: '#64748b' }}>
              Create an endpoint to capture leads from your landing pages, checkouts, or payment flows.
            </p>
            <button
              type="button"
              className="btn-meta-clean"
              onClick={() => setIsModalOpen(true)}
              style={{ marginTop: '8px' }}
            >
              <Plus size={13} /> Create Form
            </button>
          </div>
        ) : (
          <div className="meta-forms-table">
            {forms.map((form) => {
              const currentPipeline = pipelines.find((p) => p.id === form.pipeline_id);

              return (
                <div key={form.id || form.form_id} className="meta-form-row-item">
                  <div className="meta-form-identity">
                    <div className="meta-doc-tile">
                      <Globe size={16} color="#475569" />
                    </div>
                    <div className="meta-form-info-col">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span className="meta-form-title">{form.form_name}</span>
                        <code style={{ fontSize: '10.5px', color: '#64748b', background: '#f1f5f9', padding: '1px 5px', borderRadius: '4px' }}>
                          {form.form_id}
                        </code>
                      </div>

                      <div className="meta-form-meta-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        {(() => {
                          const sites = Array.isArray(form.connected_sites) && form.connected_sites.length > 0
                            ? form.connected_sites
                            : (Array.isArray(form.tags) ? form.tags : []);

                          if (sites.length === 0) {
                            return (
                              <span style={{ fontSize: '11px', color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#cbd5e1', display: 'inline-block' }} />
                                No site connected yet
                              </span>
                            );
                          }

                          if (sites.length === 1) {
                            return (
                              <span className="meta-connected-badge" style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                                Active on {sites[0]}
                              </span>
                            );
                          }

                          return (
                            <span
                              className="meta-connected-badge"
                              style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}
                              data-tooltip={sites.join(', ')}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                              Active on {sites.length} sites
                            </span>
                          );
                        })()}

                        {/* Pipeline Routing Selector */}
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          <GitBranch size={12} color="#64748b" />
                          <select
                            className="wf-pipe-select"
                            value={form.pipeline_id || ''}
                            onChange={(e) => handleUpdateFormPipeline(form.id, e.target.value)}
                            title="Target Pipeline for incoming leads"
                          >
                            <option value="" disabled>Select Pipeline...</option>
                            {pipelines.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="meta-form-actions-col">
                    <button
                      type="button"
                      className="btn-meta-clean"
                      onClick={() => {
                        setSelectedScriptForm(form);
                        setScriptTab('passive');
                        setScriptCopied(false);
                        setTestResult(null);
                      }}
                      title="Get integration code & webhook specs"
                      style={{ height: '30px', padding: '0 10px', fontSize: '11.5px', gap: '6px' }}
                    >
                      <Code size={13} />
                      <span>Integration Code</span>
                    </button>

                    <button
                      type="button"
                      className="btn-meta-icon-trash"
                      onClick={() => handleDeleteForm(form)}
                      data-tooltip="Delete form"
                      data-tooltip-pos="right-edge"
                      aria-label="Delete form"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 3: SETUP PROCEDURE GUIDE (COLLAPSIBLE) */}
      <div className="meta-panel-card">
        <div
          className="meta-panel-header"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setIsGuideOpen(!isGuideOpen)}
        >
          <div className="meta-panel-header-left">
            <span className="meta-panel-title">Integration & Embed Guide</span>
            <span className="meta-count-badge">4 steps</span>
          </div>

          <button
            type="button"
            className="btn-meta-clean"
            onClick={(e) => {
              e.stopPropagation();
              setIsGuideOpen(!isGuideOpen);
            }}
            style={{ height: '30px', padding: '0 10px', fontSize: '12px', gap: '6px' }}
          >
            <HelpCircle size={13} />
            <span>{isGuideOpen ? 'Hide Guide' : 'View Guide'}</span>
            {isGuideOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>

        {isGuideOpen && (
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <span className="pipeline-number-index" style={{ lineHeight: 1.15, flexShrink: 0 }}>1</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '15px', fontWeight: 500, color: '#0f172a', lineHeight: 1.3 }}>
                  Assign to a Pipeline
                </span>
                <span style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.55 }}>
                  Choose which pipeline incoming leads should route to. You can switch pipelines at any time from the dropdown in the forms table above.
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <span className="pipeline-number-index" style={{ lineHeight: 1.15, flexShrink: 0 }}>2</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '15px', fontWeight: 500, color: '#0f172a', lineHeight: 1.3 }}>
                  Choose Integration Method
                </span>
                <span style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.55 }}>
                  Use the <strong>Passive Web Script</strong> for HTML / Webflow / WordPress sites (it transparently intercepts form submits without altering checkout flows). For React, Next.js, and custom checkout flows, use the <strong>Server-Side Webhook</strong>.
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <span className="pipeline-number-index" style={{ lineHeight: 1.15, flexShrink: 0 }}>3</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '15px', fontWeight: 500, color: '#0f172a', lineHeight: 1.3 }}>
                  Pre-Payment / Checkout Lead Capture
                </span>
                <span style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.55 }}>
                  To capture leads even if customers abandon before paying, forward the contact details inside your backend checkout handler or use the <strong>Drop-Off Capture</strong> snippet.
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <span className="pipeline-number-index" style={{ lineHeight: 1.15, flexShrink: 0 }}>4</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '15px', fontWeight: 500, color: '#0f172a', lineHeight: 1.3 }}>
                  Automatic Ad & Field Attribution
                </span>
                <span style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.55 }}>
                  Standard inputs (<code className="meta-code-inline">name</code>, <code className="meta-code-inline">email</code>, <code className="meta-code-inline">phone</code>, <code className="meta-code-inline">city</code>) map to primary lead fields. UTM parameters (<code className="meta-code-inline">utm_source</code>, <code className="meta-code-inline">utm_campaign</code>) and custom inputs are saved automatically as custom fields.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Integration Code Modal */}
      {selectedScriptForm && createPortal(
        <div className="meta-modal-backdrop" onClick={() => setSelectedScriptForm(null)}>
          <div className="meta-modal" style={{ maxWidth: '720px' }} onClick={(e) => e.stopPropagation()}>
            <div className="meta-modal-header">
              <div>
                <h3 className="meta-modal-title">Website Form Integration Hub</h3>
                <p className="meta-modal-subtitle" style={{ marginTop: '2px', fontSize: '12px', color: '#64748b' }}>
                  {selectedScriptForm.form_name} &middot; <code style={{ fontSize: '11px' }}>{selectedScriptForm.form_id}</code>
                </p>
              </div>
              <button
                type="button"
                className="meta-modal-close-btn"
                onClick={() => setSelectedScriptForm(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="meta-modal-body" style={{ padding: '20px' }}>
              {/* Simulator & Ingestion Test Banner */}
              <div className={`wf-test-banner ${testResult ? (testResult.success ? 'success' : 'error') : ''}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldCheck size={16} color={testResult?.success ? '#16a34a' : '#64748b'} />
                  <span>
                    {testResult ? testResult.message : 'Verify your webhook endpoint by sending a test lead payload.'}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-meta-clean"
                  onClick={() => handleSendTestLead(selectedScriptForm)}
                  disabled={isTestingLead}
                  style={{ height: '28px', padding: '0 10px', fontSize: '11.5px', gap: '5px' }}
                >
                  <Send size={12} />
                  <span>{isTestingLead ? 'Sending...' : 'Send Test Lead'}</span>
                </button>
              </div>

              {/* Segmented Tab Bar */}
              <div className="wf-tab-bar">
                <button
                  type="button"
                  className={`wf-tab-btn ${scriptTab === 'passive' ? 'active' : ''}`}
                  onClick={() => setScriptTab('passive')}
                >
                  <Globe size={13} />
                  <span>Passive Script (HTML/Webflow)</span>
                </button>
                <button
                  type="button"
                  className={`wf-tab-btn ${scriptTab === 'server' ? 'active' : ''}`}
                  onClick={() => setScriptTab('server')}
                >
                  <Server size={13} />
                  <span>Server-Side (React / Checkout)</span>
                </button>
                <button
                  type="button"
                  className={`wf-tab-btn ${scriptTab === 'abandonment' ? 'active' : ''}`}
                  onClick={() => setScriptTab('abandonment')}
                >
                  <Zap size={13} />
                  <span>Drop-Off Capture</span>
                </button>
                <button
                  type="button"
                  className={`wf-tab-btn ${scriptTab === 'curl' ? 'active' : ''}`}
                  onClick={() => setScriptTab('curl')}
                >
                  <Terminal size={13} />
                  <span>cURL</span>
                </button>
              </div>

              {/* Tab Explanations */}
              {scriptTab === 'passive' && (
                <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                  <strong>Zero-Interruption Interceptor:</strong> Paste this into your site header or footer before <code className="meta-code-inline">&lt;/body&gt;</code>. It silently captures all submissions and UTM tags using <code className="meta-code-inline">sendBeacon</code> without stopping form redirects or payment.
                </p>
              )}
              {scriptTab === 'server' && (
                <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                  <strong>100% Ad-Blocker Proof:</strong> Call this from your backend server function (e.g. Next.js, Node.js, Python, or enrollment checkout handler) before opening payment. Guarantees lead capture even if visitors use Brave or uBlock.
                </p>
              )}
              {scriptTab === 'abandonment' && (
                <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                  <strong>Pre-Payment Abandonment Capture:</strong> Listens for <code className="meta-code-inline">change</code> events on email and phone fields. If a visitor types their contact info and drops off without completing payment, your CRM still receives their lead.
                </p>
              )}
              {scriptTab === 'curl' && (
                <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                  <strong>Direct HTTP Testing:</strong> Use this cURL command in your terminal to test webhook ingestion and custom field mapping.
                </p>
              )}

              {/* Code Box */}
              <div className="meta-script-preview-box">
                <div className="meta-script-preview-bar">
                  <div className="meta-script-dots">
                    <span className="meta-script-dot red" />
                    <span className="meta-script-dot yellow" />
                    <span className="meta-script-dot green" />
                    <span className="meta-script-filename">
                      {scriptTab === 'passive' && 'passive-interceptor.html'}
                      {scriptTab === 'server' && 'crm-forwarder.ts'}
                      {scriptTab === 'abandonment' && 'dropoff-capture.html'}
                      {scriptTab === 'curl' && 'test-webhook.sh'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="meta-script-copy-btn"
                    onClick={handleCopyScript}
                  >
                    {scriptCopied ? (
                      <>
                        <Check size={12} color="#4ade80" />
                        <span style={{ color: '#4ade80' }}>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="meta-script-code-wrap">
                  <pre className="meta-script-code">
                    {getActiveCode(selectedScriptForm.form_id)}
                  </pre>
                </div>
              </div>
            </div>

            <div className="meta-modal-footer">
              <button
                type="button"
                className="btn-meta-clean"
                onClick={() => setSelectedScriptForm(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-meta-primary"
                onClick={handleCopyScript}
              >
                {scriptCopied ? 'Copied to Clipboard' : 'Copy Code'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Clean Create Modal */}
      {isModalOpen && createPortal(
        <div className="meta-modal-backdrop" onClick={() => !isCreating && setIsModalOpen(false)}>
          <div className="meta-modal" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="meta-modal-header">
              <div>
                <h3 className="meta-modal-title">New Website Form</h3>
              </div>
              <button
                type="button"
                className="meta-modal-close-btn"
                onClick={() => !isCreating && setIsModalOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateForm}>
              <div className="meta-modal-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Form Name
                  </label>
                  <input
                    type="text"
                    autoFocus
                    required
                    className="meta-input-field"
                    placeholder="e.g. Checkout Enrolment Form"
                    value={newFormName}
                    onChange={(e) => setNewFormName(e.target.value)}
                    style={{
                      width: '100%',
                      height: '38px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      padding: '0 12px',
                      fontSize: '13px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Route Leads to Pipeline
                  </label>
                  <select
                    value={newFormPipelineId}
                    onChange={(e) => setNewFormPipelineId(e.target.value)}
                    style={{
                      width: '100%',
                      height: '38px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      padding: '0 12px',
                      fontSize: '13px',
                      boxSizing: 'border-box',
                      background: '#ffffff',
                      color: '#0f172a'
                    }}
                  >
                    {pipelines.length === 0 ? (
                      <option value="">Default Pipeline</option>
                    ) : (
                      pipelines.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))
                    )}
                  </select>
                  <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#64748b' }}>
                    Incoming submissions will automatically appear in this pipeline's entry stage.
                  </p>
                </div>
              </div>

              <div className="meta-modal-footer">
                <button
                  type="button"
                  className="btn-meta-clean"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isCreating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-meta-primary"
                  disabled={!newFormName.trim() || isCreating}
                >
                  {isCreating ? 'Creating...' : 'Create Form'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
