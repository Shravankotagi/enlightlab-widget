'use client';

import React, { useEffect } from 'react';

export default function WidgetTestPage() {
  useEffect(() => {
    // Inject our embed script dynamically to simulate target client installation
    const script = document.createElement('script');
    script.src = '/widget.js';
    script.setAttribute('data-client', 'enlightlab');
    script.async = true;
    document.body.appendChild(script);
    
    return () => {
      // Cleanup on unmount
      const existingContainer = document.getElementById('enlight-widget-container');
      if (existingContainer) {
        existingContainer.remove();
      }
      document.body.removeChild(script);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-md text-center space-y-4">
        <div className="text-5xl">🤖</div>
        <h1 className="text-3xl font-black tracking-tight">AI Widget Test Harness</h1>
        <p className="text-slate-400 text-sm leading-relaxed">
          This test page simulates the client installation by loading the static <code className="bg-slate-800 px-1.5 py-0.5 rounded text-pink-400 text-xs">/widget.js</code> loader.
        </p>
        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 text-left text-xs space-y-2 text-slate-300">
          <p className="font-bold text-slate-100 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block animate-ping"></span>
            Loader Sequence:
          </p>
          <p>1. Inject loader with <code className="text-amber-400">data-client="enlightlab"</code> attribute.</p>
          <p>2. Loader resolves domain origin and appends bubble iframe.</p>
          <p>3. Dwell timer auto-opens the bubble welcome text after 5 seconds.</p>
        </div>
      </div>
    </div>
  );
}
