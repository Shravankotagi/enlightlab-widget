(function() {
  if (window.__enlightLabWidgetLoaded) return;
  window.__enlightLabWidgetLoaded = true;

  // Retrieve origin dynamically from script src
  const scriptTag = document.currentScript;
  const scriptSrc = scriptTag ? scriptTag.src : 'http://localhost:3000/widget.js';
  
  let baseUrl = 'http://localhost:3000';
  try {
    const urlObj = new URL(scriptSrc);
    baseUrl = urlObj.origin;
  } catch (e) {
    console.error('[Widget Loader] Failed to resolve base URL from script src:', e);
  }

  const clientName = scriptTag ? scriptTag.getAttribute('data-client') : 'enlightlab';

  // Create fixed outer container to house widget iframe
  const container = document.createElement('div');
  container.id = 'enlight-widget-container';
  container.style.position = 'fixed';
  container.style.bottom = '20px';
  container.style.right = '20px';
  container.style.width = '65px';
  container.style.height = '65px';
  container.style.zIndex = '99999999';
  container.style.transition = 'width 0.25s cubic-bezier(0.1, 0.8, 0.25, 1), height 0.25s cubic-bezier(0.1, 0.8, 0.25, 1), border-radius 0.25s';
  container.style.borderRadius = '50%';
  container.style.boxShadow = '0 6px 24px rgba(0,0,0,0.12)';
  container.style.overflow = 'hidden';
  container.style.backgroundColor = 'transparent';

  // Embed the widget React frame
  const iframe = document.createElement('iframe');
  iframe.src = baseUrl + '/widget?client=' + clientName;
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  iframe.style.background = 'transparent';
  iframe.setAttribute('allow', 'microphone');

  container.appendChild(iframe);
  document.body.appendChild(container);

  // Configurable Dwell Time auto-open logic
  let dwellTimer;
  fetch(baseUrl + '/api/widget/config')
    .then(r => r.json())
    .then(config => {
      const dwellSeconds = config.dwellTime || 5;
      dwellTimer = setTimeout(() => {
        iframe.contentWindow.postMessage({ type: 'trigger-dwell' }, '*');
      }, dwellSeconds * 1000);
    })
    .catch(err => console.warn('[Widget Embed] Failed to fetch configuration:', err));

  // Receive viewport control signals from the iframe
  window.addEventListener('message', function(event) {
    if (event.origin !== baseUrl) return;
    const msg = event.data;
    
    if (msg.type === 'toggle-open') {
      if (dwellTimer) clearTimeout(dwellTimer);
      container.style.width = '380px';
      container.style.height = '600px';
      container.style.borderRadius = '24px';
    } else if (msg.type === 'toggle-close') {
      container.style.width = '65px';
      container.style.height = '65px';
      container.style.borderRadius = '50%';
    } else if (msg.type === 'resize-calendar') {
      container.style.width = '460px';
      container.style.height = '650px';
      container.style.borderRadius = '24px';
    }
  });
})();
