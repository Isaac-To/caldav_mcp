import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const clientScript = (origin: string) => `
const $ = id => document.getElementById(id);
const show = (el, text) => el.textContent = text;
let slide = 0;
const slides = [...document.querySelectorAll('[data-slide]')];
const renderSlide = () => { slides.forEach((item, index) => item.hidden = index !== slide); $('back').disabled = slide === 0; $('next').hidden = slide === slides.length - 1; $('makeToken').hidden = slide !== slides.length - 1; $('progress').textContent = (slide + 1) + ' / ' + slides.length; };
const validateSlide = () => { for (const field of slides[slide].querySelectorAll('input, select')) { if (!field.checkValidity()) { field.reportValidity(); return false; } } return true; };
const move = direction => { if (direction > 0 && !validateSlide()) return; slide = Math.max(0, Math.min(slides.length - 1, slide + direction)); renderSlide(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
const connection = () => {
  if (!$('serverUrl').value || !$('username').value || !$('password').value) throw new Error('Enter the server URL, username, and app password.');
  const value = { serverUrl: $('serverUrl').value, username: $('username').value, password: $('password').value };
  if ($('calendarUrl').value) value.calendarUrl = $('calendarUrl').value;
  return value;
};
$('provider').onchange = () => {
  const settings = {
    nextcloud: { hint: 'Use an app password from your Nextcloud security settings. Your server URL depends on your organization.', server: '', placeholder: 'https://cloud.example.com' },
    fastmail: { hint: 'Fastmail’s CalDAV server is prefilled. Your calendar URL can be discovered automatically.', server: 'https://caldav.fastmail.com/dav/', placeholder: 'https://caldav.fastmail.com/dav/' },
    icloud: { hint: 'iCloud’s CalDAV server is prefilled. Use an Apple app-specific password.', server: 'https://caldav.icloud.com/', placeholder: 'https://caldav.icloud.com/' },
    other: { hint: 'Use the CalDAV details supplied by your provider.', server: '', placeholder: 'https://caldav.example.com' },
  };
  const setting = settings[$('provider').value] || { hint: 'Choose your provider for a quick hint.', server: '', placeholder: 'https://caldav.example.com' };
  $('serverUrl').value = setting.server;
  $('serverUrl').placeholder = setting.placeholder;
  show($('providerHelp'), setting.hint);
};
$('back').onclick = () => move(-1);
$('next').onclick = () => move(1);
$('makeToken').onclick = async () => {
  try {
    const response = await fetch('/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(connection()) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not create token.');
    const url = '${origin}/mcp/' + body.token;
    $('mcpUrl').value = url;
    $('config').value = JSON.stringify({ mcpServers: { caldav: { type: 'http', url } } }, null, 2);
    show($('made'), 'Your secure connection is ready.');
    $('connect').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { show($('made'), error.message); }
};
$('copyUrl').onclick = async () => { await navigator.clipboard.writeText($('mcpUrl').value); show($('connectStatus'), 'MCP URL copied.'); };
$('copyConfig').onclick = async () => { await navigator.clipboard.writeText($('config').value); show($('connectStatus'), 'Configuration copied.'); };
renderSlide();
`;

export function homePage(origin: string): Response {
  const app = <>
    <style>{`\n      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #fbf6ef; color: #3a2d28; }\n      * { box-sizing: border-box; } body { margin: 0; }\n      .shell { max-width: 880px; margin: auto; padding: 56px 20px 80px; }\n      .hero { display: flex; gap: 18px; align-items: flex-start; margin-bottom: 34px; }\n      .mark { flex: 0 0 48px; height: 48px; display: grid; place-items: center; background: #7a4636; color: #fffaf4; border: 0; }\n      .mark svg { width: 27px; height: 27px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: square; stroke-linejoin: miter; }\n      h1, h2 { margin: 0; letter-spacing: -.025em; } h1 { font-size: clamp(2rem, 5vw, 3.25rem); line-height: 1.05; color: #3a2d28; } h2 { font-size: 1.2rem; color: #704535; }\n      .lede { margin: 10px 0 0; color: #806e64; font-size: 1.05rem; }\n      .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin: 0 0 24px; border: 1px solid #e2d2c4; background: #fffaf4; }\n      .step { padding: 15px 16px; border-right: 1px solid #e2d2c4; color: #6d5a50; font-size: .94rem; } .step:last-child { border-right: 0; } .step b { color: #b36f50; margin-right: 7px; font-size: .8rem; letter-spacing: .08em; }\n      .panel { padding: 28px; margin: 18px 0; background: #fffaf4; border: 1px solid #e2d2c4; box-shadow: 0 8px 24px #70453512; } .panel.soft { background: #f5e8dc; border-color: #e3c9b8; box-shadow: none; }\n      [data-slide][hidden] { display: none; } .navigation { display: flex; justify-content: space-between; align-items: center; margin-top: 24px; }\n      label { display: block; font-weight: 650; margin: 17px 0 7px; color: #5b4035; }\n      input, select, textarea { width: 100%; border: 1px solid #cdb7a8; border-radius: 2px; background: #fffdf9; padding: 12px; font: inherit; color: inherit; transition: border-color .15s, box-shadow .15s; }\n      input:focus, select:focus, textarea:focus { outline: none; border-color: #a35f45; box-shadow: 0 0 0 3px #a35f4522; }\n      textarea { min-height: 108px; resize: vertical; }\n      .hint, .fine, .status { color: #806e64; font-size: .92rem; } .warning { border-left: 3px solid #c7815d; padding: 12px 15px; background: #f8e8dc; margin: 18px 0; color: #694d40; }\n      button { border: 1px solid #7a4636; border-radius: 2px; padding: 11px 16px; font: inherit; font-weight: 700; cursor: pointer; margin: 18px 8px 0 0; transition: background .15s, transform .15s; }\n      button.primary { background: #7a4636; color: #fffaf4; } button.primary:hover { background: #653a2e; } button.secondary { background: #ead6c6; color: #704535; border-color: #c9a58e; } button.secondary:hover { background: #e1c6b1; } button:active { transform: translateY(1px); }\n      output { display: block; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 13px; } code { background: #f0dfd1; padding: 2px 5px; }\n      @media (max-width: 650px) { .shell { padding-top: 30px; } .steps { grid-template-columns: 1fr; } .panel { padding: 18px; } }\n    `}</style>
    <main className="shell">
      <header className="hero"><div className="mark" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="16" /><path d="M7 3.5v4M17 3.5v4M3.5 9.5h17M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 17h.01M12 17h.01" /></svg></div><div><h1>CalDAV, connected.</h1><p className="lede">A calm, secure bridge between your calendar and your AI assistant.</p></div></header>
      <div className="steps"><div className="step"><b>01</b> Your provider</div><div className="step"><b>02</b> Connection details</div><div className="step"><b>03</b> Connect your AI</div></div>
      <div className="warning"><strong>Privacy first.</strong> Use an app password when possible. Your details are sent over HTTPS only to create an encrypted token.</div>
      <section data-slide="0" className="panel"><h2>01 / Your provider</h2><p className="hint">We’ll guide you through the connection one step at a time.</p>
        <label htmlFor="provider">Provider</label><select id="provider" required><option value="">Choose a provider</option><option value="nextcloud">Nextcloud</option><option value="fastmail">Fastmail</option><option value="icloud">iCloud</option><option value="other">Other</option></select><p id="providerHelp" className="hint">Choose your provider for a quick hint.</p>
      </section>
      <section data-slide="1" className="panel" hidden><h2>02 / Connection details</h2><p className="hint">Use the CalDAV details from your provider. Calendar URL is optional.</p>
        <label htmlFor="serverUrl">CalDAV server URL</label><input id="serverUrl" type="url" placeholder="https://caldav.example.com" autoComplete="url" required />
        <label htmlFor="calendarUrl">Calendar URL <span className="fine">(optional — discovery works without it)</span></label><input id="calendarUrl" type="url" placeholder="https://caldav.example.com/calendars/..." />
        <label htmlFor="username">Username</label><input id="username" autoComplete="username" required />
        <label htmlFor="password">App password</label><input id="password" type="password" autoComplete="current-password" required />
      </section>
      <section data-slide="2" id="connect" className="panel soft" hidden><h2>03 / Connect your AI assistant</h2><p className="hint">Create your secure token, then copy one option into your MCP-compatible assistant.</p>
        <button id="makeToken" className="primary">Create secure token →</button><output id="made" className="status" aria-live="polite" />
        <label htmlFor="mcpUrl">MCP URL</label><textarea id="mcpUrl" readOnly placeholder="Your URL appears here after token creation" /><button id="copyUrl" className="secondary">Copy URL</button>
        <label htmlFor="config">Configuration</label><textarea id="config" readOnly placeholder="Your configuration appears here after token creation" /><button id="copyConfig" className="secondary">Copy configuration</button><output id="connectStatus" className="status" aria-live="polite" />
      </section>
      <nav className="navigation" aria-label="Setup navigation"><button id="back" className="secondary" type="button">← Back</button><span id="progress" className="status" aria-live="polite" /><button id="next" className="primary" type="button">Next →</button></nav>
      <p className="fine">Tokens are permanent and opaque. Rotate <code>CONNECTION_TOKEN_KEY</code> to revoke existing tokens. The service stores no calendar data.</p>
    </main>
    <script dangerouslySetInnerHTML={{ __html: clientScript(origin) }} />
  </>;
  const html = '<!doctype html>' + renderToStaticMarkup(<html lang="en"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>CalDAV MCP Forwarder</title></head><body>{app}</body></html>);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
