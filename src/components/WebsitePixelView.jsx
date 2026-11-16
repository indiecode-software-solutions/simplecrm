import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  Globe,
  Copy,
  Check,
  Send,
  Zap,
  RefreshCw,
  Eye,
  MousePointer,
  Share2,
  Compass,
  ShieldCheck,
  AlertCircle,
  X,
  Code,
  ArrowUpRight,
  TrendingUp,
  Clock
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getActiveCompanyId } from '../lib/tenant';
import Skeleton from './common/Skeleton';
import '../styles/meta.css';

export default function WebsitePixelView({ currentUser }) {
  const [pixelId, setPixelId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScriptModalOpen, setIsScriptModalOpen] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [pixelIdCopied, setPixelIdCopied] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testFeedback, setTestFeedback] = useState(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

  // 1. Fetch Pixel Config & Initial Events
  const fetchData = async () => {
    const companyId = getActiveCompanyId();
    if (!companyId) {
      setIsLoading(false);
      return;
    }

    try {
      // Get company pixel_id
      const { data: comp } = await supabase
        .from('companies')
        .select('id, name, slug, pixel_id')
        .eq('id', companyId)
        .maybeSingle();

      if (comp) {
        setCompanyName(comp.name || 'Workspace');
        const resolvedPid = comp.pixel_id || `px_${comp.id.replace(/-/g, '').slice(0, 16)}`;
        setPixelId(resolvedPid);
      }

      // Fetch recent 60 events
      const { data: eventsRes, error: eventsErr } = await supabase
        .from('website_pixel_events')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(60);

      if (!eventsErr && eventsRes) {
        setEvents(eventsRes);
      }
    } catch (err) {
      console.warn('Error loading website pixel data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // 2. Realtime Stream Subscription
    const companyId = getActiveCompanyId();
    if (!companyId) return;

    const channel = supabase
      .channel(`pixel-stream-${companyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'website_pixel_events',
          filter: `company_id=eq.${companyId}`
        },
        (payload) => {
          if (payload.new) {
            setEvents((prev) => [payload.new, ...prev.slice(0, 79)]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Compute Analytics
  const analytics = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const todayEvents = events.filter((e) => new Date(e.created_at).getTime() >= startOfToday);
    const pageviews = todayEvents.filter((e) => e.event_name === 'PageView');
    const clicks = todayEvents.filter((e) => e.event_name !== 'PageView');

    // Page frequency map
    const pageMap = {};
    todayEvents.forEach((e) => {
      let path = '/';
      if (e.page_url) {
        try {
          path = new URL(e.page_url).pathname || '/';
        } catch {
          path = e.page_url;
        }
      }
      pageMap[path] = (pageMap[path] || 0) + 1;
    });

    const topPages = Object.entries(pageMap)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Source frequency map
    const sourceMap = {};
    todayEvents.forEach((e) => {
      let src = 'Direct';
      if (e.utm_source) {
        src = `Ad: ${e.utm_source}`;
      } else if (e.referrer) {
        try {
          src = new URL(e.referrer).hostname.replace(/^www\./, '');
        } catch {
          src = 'Referral';
        }
      }
      sourceMap[src] = (sourceMap[src] || 0) + 1;
    });

    const topSources = Object.entries(sourceMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    return {
      totalToday: todayEvents.length,
      pageviewsToday: pageviews.length,
      clicksToday: clicks.length,
      topPages,
      topSources,
      lastEvent: events.length > 0 ? events[0] : null
    };
  }, [events]);

  const pixelSnippet = `<!-- simplecrm Website Pixel -->
<script>
(function() {
  var pid = '${pixelId}';
  var endpoint = '${supabaseUrl}/functions/v1/website-pixel';

  function track(eventName, customData) {
    var payload = Object.assign({
      tracking_id: pid,
      event_name: eventName || 'PageView',
      page_url: window.location.href,
      page_title: document.title,
      site_domain: window.location.hostname,
      referrer: document.referrer || '',
      session_id: window.sessionStorage.getItem('_sc_sid') || (function() {
        var sid = 'sid_' + Math.random().toString(36).substring(2, 10);
        window.sessionStorage.setItem('_sc_sid', sid);
        return sid;
      })()
    }, customData || {});

    var params = new URLSearchParams(window.location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function(k) {
      if (params.get(k)) payload[k] = params.get(k);
    });

    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function(){});
    }
  }

  // Automatic PageView on page load
  track('PageView');

  // Expose global helper for custom click tracking
  window.scPixel = { track: track };
})();
</script>`;

  const handleCopyScript = () => {
    navigator.clipboard.writeText(pixelSnippet);
    setScriptCopied(true);
    setTimeout(() => setScriptCopied(false), 2000);
  };

  const handleCopyPixelId = () => {
    navigator.clipboard.writeText(pixelId);
    setPixelIdCopied(true);
    setTimeout(() => setPixelIdCopied(false), 2000);
  };

  const handleSendTestEvent = async () => {
    setIsTesting(true);
    setTestFeedback(null);
    try {
      const endpoint = `${supabaseUrl}/functions/v1/website-pixel`;
      const payload = {
        tracking_id: pixelId,
        event_name: 'PageView',
        page_url: `${window.location.origin}/pricing`,
        page_title: 'Pricing & Plans | simplecrm Simulator',
        site_domain: window.location.hostname || 'simulator.local',
        utm_source: 'meta_instagram',
        utm_medium: 'story_ad',
        utm_campaign: 'spring_special'
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resJson = await res.json();
      if (!res.ok || resJson.error) {
        throw new Error(resJson.error || 'Failed to send test event');
      }

      setTestFeedback({
        type: 'success',
        message: 'Live event recorded! See it appear at the top of your activity stream.'
      });
      setTimeout(() => setTestFeedback(null), 4000);
    } catch (err) {
      setTestFeedback({
        type: 'error',
        message: err.message || 'Error communicating with pixel endpoint'
      });
    } finally {
      setIsTesting(false);
    }
  };

  const formatEventTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatRelativeTime = (isoString) => {
    if (!isoString) return 'Never';
    const seconds = Math.floor((new Date() - new Date(isoString)) / 1000);
    if (seconds < 60) return `${Math.max(1, seconds)}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
        <div className="meta-panel-card">
          <Skeleton width="100%" height="90px" borderRadius="10px" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width="100%" height="80px" borderRadius="10px" />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <Skeleton width="100%" height="340px" borderRadius="10px" />
          <Skeleton width="100%" height="340px" borderRadius="10px" />
        </div>
      </div>
    );
  }

  const isLive = events.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
      {/* SECTION 1: HERO HEADER CARD */}
      <div className="meta-panel-card">
        <div className="meta-account-row">
          <div className="meta-account-identity">
            <div className="meta-brand-tile" style={{ background: '#f8fafc', color: '#0f172a' }}>
              <Activity size={22} color="#0f172a" />
            </div>
            <div className="meta-account-details">
              <div className="meta-account-title-line" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span className="meta-account-name">Website Activity Pixel</span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    background: '#f1f5f9',
                    padding: '2px 8px',
                    borderRadius: '5px',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: '11.5px',
                    color: '#334155',
                    cursor: 'pointer'
                  }}
                  onClick={handleCopyPixelId}
                  title="Click to copy Tracking ID"
                >
                  <code>{pixelId}</code>
                  {pixelIdCopied ? <Check size={12} color="#16a34a" /> : <Copy size={12} color="#94a3b8" />}
                </span>
              </div>
              <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                1st-party event manager. Monitors active website visitors, top visited pages, and ad campaign referrers in real time.
              </p>
            </div>
          </div>

          <div className="meta-account-actions" style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-meta-clean"
              onClick={handleSendTestEvent}
              disabled={isTesting}
              style={{ height: '34px', padding: '0 12px', fontSize: '12.5px', gap: '6px' }}
            >
              <Zap size={14} color="#f59e0b" />
              <span>{isTesting ? 'Sending...' : 'Test Event'}</span>
            </button>

            <button
              type="button"
              className="btn-meta-primary"
              onClick={() => setIsScriptModalOpen(true)}
              style={{ height: '34px', padding: '0 14px', fontSize: '12.5px', gap: '6px' }}
            >
              <Code size={14} />
              <span>Get Pixel Code</span>
            </button>
          </div>
        </div>

        <div className="meta-account-footer-row">
          <span className="meta-id-pill">
            Endpoint: <strong>{supabaseUrl ? `${supabaseUrl.replace(/^https?:\/\//, '')}/functions/v1/website-pixel` : 'Supabase Edge Functions'}</strong>
          </span>
          <span className="meta-connection-status">
            <span className={`meta-status-dot ${isLive ? 'is-connected' : ''}`} />
            {isLive ? `Live Stream Active · Last event ${formatRelativeTime(analytics.lastEvent?.created_at)}` : 'Waiting for First Event'}
          </span>
        </div>
      </div>

      {testFeedback && (
        <div
          className={`wf-test-banner ${testFeedback.type === 'success' ? 'success' : 'error'}`}
          style={{ animation: 'metaFadeIn 0.15s ease' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {testFeedback.type === 'success' ? <Check size={15} /> : <AlertCircle size={15} />}
            <span>{testFeedback.message}</span>
          </div>
        </div>
      )}

      {/* SECTION 2: METRIC CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div className="meta-panel-card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>TOTAL EVENTS TODAY</span>
            <Activity size={16} color="#3b82f6" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
            {analytics.totalToday.toLocaleString()}
          </div>
          <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', display: 'block' }}>
            All recorded website hits
          </span>
        </div>

        <div className="meta-panel-card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>PAGEVIEWS</span>
            <Eye size={16} color="#10b981" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
            {analytics.pageviewsToday.toLocaleString()}
          </div>
          <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', display: 'block' }}>
            URL navigation events
          </span>
        </div>

        <div className="meta-panel-card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>ACTIONS & CLICKS</span>
            <MousePointer size={16} color="#8b5cf6" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
            {analytics.clicksToday.toLocaleString()}
          </div>
          <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', display: 'block' }}>
            Button clicks & form submits
          </span>
        </div>

        <div className="meta-panel-card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>ACTIVE PAGES TODAY</span>
            <Globe size={16} color="#f59e0b" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
            {analytics.topPages.length}
          </div>
          <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', display: 'block' }}>
            Unique visited routes
          </span>
        </div>
      </div>

      {/* SECTION 3: SPLIT ANALYTICS & LIVE ACTIVITY STREAM */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(360px, 1.25fr)', gap: '20px' }}>
        {/* Left: Top Pages & Traffic Attribution */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Card A: Top Pages */}
          <div className="meta-panel-card">
            <div className="meta-panel-header">
              <div className="meta-panel-header-left">
                <span className="meta-panel-title">Top Active Pages Today</span>
                <span className="meta-count-badge">{analytics.topPages.length} routes</span>
              </div>
            </div>

            {analytics.topPages.length === 0 ? (
              <div style={{ padding: '36px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '12.5px' }}>
                <Globe size={22} color="#cbd5e1" style={{ margin: '0 auto 8px', display: 'block' }} />
                No page views recorded today yet.
              </div>
            ) : (
              <div style={{ padding: '10px 18px 16px' }}>
                {analytics.topPages.map((item, idx) => {
                  const pct = Math.round((item.count / (analytics.pageviewsToday || 1)) * 100);
                  return (
                    <div key={item.path} style={{ padding: '10px 0', borderBottom: idx < analytics.topPages.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <code style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>{item.path}</code>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                          <strong>{item.count}</strong> views ({pct}%)
                        </span>
                      </div>
                      <div style={{ height: '5px', width: '100%', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: '#3b82f6', borderRadius: '3px' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card B: Traffic Sources */}
          <div className="meta-panel-card">
            <div className="meta-panel-header">
              <div className="meta-panel-header-left">
                <span className="meta-panel-title">Traffic Sources</span>
                <span className="meta-count-badge">Attribution</span>
              </div>
            </div>

            {analytics.topSources.length === 0 ? (
              <div style={{ padding: '30px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '12.5px' }}>
                <Compass size={22} color="#cbd5e1" style={{ margin: '0 auto 8px', display: 'block' }} />
                No traffic sources recorded yet.
              </div>
            ) : (
              <div style={{ padding: '12px 18px' }}>
                {analytics.topSources.map((item, idx) => (
                  <div key={item.source} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: idx < analytics.topSources.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="wf-feature-pill blue" style={{ fontSize: '10.5px' }}>
                        {item.source.startsWith('Ad:') ? 'Campaign' : 'Referrer'}
                      </span>
                      <span style={{ fontSize: '12.5px', color: '#334155', fontWeight: 500 }}>
                        {item.source}
                      </span>
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>
                      {item.count} hits
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Live Real-time Activity Stream */}
        <div className="meta-panel-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="meta-panel-header">
            <div className="meta-panel-header-left">
              <span className="meta-panel-title">Live Activity Stream</span>
              <span className="meta-count-badge" style={{ background: '#ecfdf5', color: '#059669', borderColor: '#bbf7d0' }}>
                Real-time
              </span>
            </div>

            <button
              type="button"
              className="btn-meta-clean"
              onClick={fetchData}
              title="Refresh stream"
              style={{ height: '28px', padding: '0 8px', fontSize: '11px', gap: '4px' }}
            >
              <RefreshCw size={11} />
              <span>Refresh</span>
            </button>
          </div>

          {events.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
              <Activity size={28} color="#cbd5e1" style={{ margin: '0 auto 10px', display: 'block' }} />
              <p style={{ fontWeight: 600, color: '#475569', margin: '0 0 4px' }}>No events recorded yet</p>
              <p style={{ margin: '0 0 16px', fontSize: '12px', color: '#94a3b8' }}>
                Install your pixel snippet or click "Test Event" to verify the stream.
              </p>
              <button
                type="button"
                className="btn-meta-clean"
                onClick={handleSendTestEvent}
                style={{ fontSize: '12px', margin: '0 auto' }}
              >
                <Zap size={13} color="#f59e0b" />
                <span>Fire Sample Event</span>
              </button>
            </div>
          ) : (
            <div style={{ maxHeight: '540px', overflowY: 'auto', padding: '6px 14px' }}>
              {events.map((ev) => {
                let displayPath = '/';
                if (ev.page_url) {
                  try {
                    displayPath = new URL(ev.page_url).pathname || '/';
                  } catch {
                    displayPath = ev.page_url;
                  }
                }

                const isPageview = ev.event_name === 'PageView';

                return (
                  <div
                    key={ev.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      padding: '10px 6px',
                      borderBottom: '1px solid #f8fafc',
                      gap: '12px',
                      transition: 'background 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', minWidth: 0 }}>
                      <span
                        className={`wf-feature-pill ${isPageview ? 'green' : 'purple'}`}
                        style={{ marginTop: '2px', fontSize: '10.5px' }}
                      >
                        {ev.event_name}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>
                            {displayPath}
                          </span>
                          {ev.site_domain && (
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>({ev.site_domain})</span>
                          )}
                        </div>

                        {ev.page_title && (
                          <div style={{ fontSize: '11.5px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '300px' }}>
                            {ev.page_title}
                          </div>
                        )}

                        {(ev.utm_source || ev.utm_campaign) && (
                          <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                            <span style={{ fontSize: '10.5px', background: '#eff6ff', color: '#2563eb', padding: '1px 5px', borderRadius: '4px' }}>
                              Ad: {ev.utm_source || 'ad'} {ev.utm_campaign ? `(${ev.utm_campaign})` : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '11.5px', fontWeight: 500, color: '#475569' }}>
                        {formatEventTime(ev.created_at)}
                      </div>
                      <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                        {formatRelativeTime(ev.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* MODAL: Get Pixel Script */}
      {isScriptModalOpen && createPortal(
        <div className="meta-modal-backdrop" onClick={() => setIsScriptModalOpen(false)}>
          <div className="meta-modal" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
            <div className="meta-modal-header" style={{ padding: '18px 22px 14px' }}>
              <div>
                <h3 className="meta-modal-title" style={{ fontSize: '16px' }}>
                  Install simplecrm Website Pixel
                </h3>
                <p className="meta-modal-subtitle" style={{ fontSize: '12px', marginTop: '2px', color: '#64748b' }}>
                  {companyName} &middot; Tracking ID: <code>{pixelId}</code>
                </p>
              </div>
              <button
                type="button"
                className="meta-modal-close-btn"
                onClick={() => setIsScriptModalOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="meta-modal-body" style={{ padding: '18px 22px' }}>
              <div className="wf-feature-callout">
                <span className="wf-feature-pill green">1-Line Installation</span>
                <p className="wf-feature-text">
                  Paste this snippet inside the <code>&lt;head&gt;</code> tag of your website. It silently monitors pageviews, visit duration, and ad campaign referrers with zero impact on page speed.
                </p>
              </div>

              <div className="meta-script-preview-box">
                <div className="meta-script-preview-bar">
                  <div className="meta-script-dots">
                    <span className="meta-script-dot red" />
                    <span className="meta-script-dot yellow" />
                    <span className="meta-script-dot green" />
                    <span className="meta-script-filename">simplecrm-pixel.html</span>
                  </div>
                  <button
                    type="button"
                    className={`meta-script-copy-btn ${scriptCopied ? 'copied' : ''}`}
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
                    <span className="syn-punct">&lt;!-- simplecrm Website Pixel --&gt;</span>{'\n'}
                    <span className="syn-tag">&lt;script&gt;</span>{'\n'}
                    (<span className="syn-kw">function</span>() &#123;{'\n'}
                    {'  '}<span className="syn-kw">var</span> <span className="syn-var">pid</span> = <span className="syn-str">'{pixelId}'</span>;{'\n'}
                    {'  '}<span className="syn-kw">var</span> <span className="syn-var">endpoint</span> = <span className="syn-str">'{supabaseUrl}/functions/v1/website-pixel'</span>;{'\n'}
                    {'\n'}
                    {'  '}<span className="syn-kw">function</span> <span className="syn-fn">track</span>(<span className="syn-var">eventName</span>, <span className="syn-var">customData</span>) &#123;{'\n'}
                    {'    '}<span className="syn-kw">var</span> <span className="syn-var">payload</span> = <span className="syn-obj">Object</span>.<span className="syn-fn">assign</span>(&#123;{'\n'}
                    {'      '}<span className="syn-prop">tracking_id</span>: <span className="syn-var">pid</span>,{'\n'}
                    {'      '}<span className="syn-prop">event_name</span>: <span className="syn-var">eventName</span> || <span className="syn-str">'PageView'</span>,{'\n'}
                    {'      '}<span className="syn-prop">page_url</span>: <span className="syn-obj">window</span>.<span className="syn-prop">location</span>.<span className="syn-prop">href</span>,{'\n'}
                    {'      '}<span className="syn-prop">page_title</span>: <span className="syn-obj">document</span>.<span className="syn-prop">title</span>,{'\n'}
                    {'      '}<span className="syn-prop">site_domain</span>: <span className="syn-obj">window</span>.<span className="syn-prop">location</span>.<span className="syn-prop">hostname</span>,{'\n'}
                    {'      '}<span className="syn-prop">referrer</span>: <span className="syn-obj">document</span>.<span className="syn-prop">referrer</span> || <span className="syn-str">''</span>{'\n'}
                    {'    '}&#125;, <span className="syn-var">customData</span> || &#123;&#125;);{'\n'}
                    {'\n'}
                    {'    '}<span className="syn-kw">var</span> <span className="syn-var">params</span> = <span className="syn-kw">new</span> <span className="syn-obj">URLSearchParams</span>(<span className="syn-obj">window</span>.<span className="syn-prop">location</span>.<span className="syn-prop">search</span>);{'\n'}
                    {'    '}[<span className="syn-str">'utm_source'</span>, <span className="syn-str">'utm_medium'</span>, <span className="syn-str">'utm_campaign'</span>].<span className="syn-fn">forEach</span>(<span className="syn-kw">function</span>(k) &#123;{'\n'}
                    {'      '}<span className="syn-kw">if</span> (<span className="syn-var">params</span>.<span className="syn-fn">get</span>(k)) <span className="syn-var">payload</span>[k] = <span className="syn-var">params</span>.<span className="syn-fn">get</span>(k);{'\n'}
                    {'    '}&#125;);{'\n'}
                    {'\n'}
                    {'    '}<span className="syn-kw">var</span> <span className="syn-var">body</span> = <span className="syn-obj">JSON</span>.<span className="syn-fn">stringify</span>(<span className="syn-var">payload</span>);{'\n'}
                    {'    '}<span className="syn-kw">if</span> (<span className="syn-obj">navigator</span>.<span className="syn-prop">sendBeacon</span>) &#123;{'\n'}
                    {'      '}<span className="syn-obj">navigator</span>.<span className="syn-fn">sendBeacon</span>(<span className="syn-var">endpoint</span>, <span className="syn-kw">new</span> <span className="syn-obj">Blob</span>([<span className="syn-var">body</span>], &#123; <span className="syn-prop">type</span>: <span className="syn-str">'application/json'</span> &#125;));{'\n'}
                    {'    '}&#125; <span className="syn-kw">else</span> &#123;{'\n'}
                    {'      '}<span className="syn-fn">fetch</span>(<span className="syn-var">endpoint</span>, &#123; <span className="syn-prop">method</span>: <span className="syn-str">'POST'</span>, <span className="syn-prop">headers</span>: &#123; <span className="syn-str">'Content-Type'</span>: <span className="syn-str">'application/json'</span> &#125;, <span className="syn-prop">body</span>: <span className="syn-var">body</span>, <span className="syn-prop">keepalive</span>: <span className="syn-kw">true</span> &#125;).<span className="syn-fn">catch</span>(<span className="syn-kw">function</span>()&#123;&#125;);{'\n'}
                    {'    '}&#125;{'\n'}
                    {'  '}&#125;{'\n'}
                    {'\n'}
                    {'  '}<span className="syn-punct">// Track PageView on load</span>{'\n'}
                    {'  '}<span className="syn-fn">track</span>(<span className="syn-str">'PageView'</span>);{'\n'}
                    {'  '}<span className="syn-obj">window</span>.<span className="syn-prop">scPixel</span> = &#123; <span className="syn-prop">track</span>: <span className="syn-var">track</span> &#125;;{'\n'}
                    &#125;)();{'\n'}
                    <span className="syn-tag">&lt;/script&gt;</span>
                  </pre>
                </div>
              </div>

              <div style={{ marginTop: '14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>Optional: Custom Button Click Tracking</span>
                <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                  To track a specific button click (e.g. "Proceed to Checkout"), add this 1-liner to your button's <code>onClick</code>:
                </p>
                <code style={{ display: 'block', marginTop: '6px', background: '#090d16', color: '#38bdf8', padding: '6px 10px', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace' }}>
                  window.scPixel && window.scPixel.track('Click', &#123; label: 'Proceed to Pay' &#125;);
                </code>
              </div>
            </div>

            <div className="meta-modal-footer" style={{ padding: '14px 22px' }}>
              <button
                type="button"
                className="meta-modal-btn-cancel"
                onClick={() => setIsScriptModalOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className={`btn-meta-primary ${scriptCopied ? 'is-copied' : ''}`}
                onClick={handleCopyScript}
              >
                {scriptCopied ? (
                  <>
                    <Check size={14} color="#ffffff" />
                    <span>Copied Snippet</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} color="#ffffff" />
                    <span>Copy Pixel Code</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
