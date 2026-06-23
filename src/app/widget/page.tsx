'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageSquare, Phone, X, Send, Mic, MicOff, Check, AlertCircle, Calendar, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface WidgetConfig {
  companyName: string;
  branding: {
    primaryColor: string;
    textColor: string;
    assistantName: string;
    welcomeMessage: string;
    logoUrl: string;
  };
  dwellTime: number;
  integrations: {
    cal: {
      eventLink: string;
    };
    googleAds: {
      conversionId: string;
      conversionLabel?: string;
    };
  };
  vapi: {
    assistantId: string;
    publicKey: string;
  };
  voice?: {
    provider: 'vapi' | 'retell';
    agentId?: string;
    apiKeyEnv?: string;
  };
}

function WidgetContent() {
  const searchParams = useSearchParams();
  const clientName = searchParams.get('client') || 'enlightlab';

  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Qualification & Integration States
  const [isHighFit, setIsHighFit] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [degradedMode, setDegradedMode] = useState(false);
  const [calBooked, setCalBooked] = useState(false);

  // Fallback Form State
  const [fallbackName, setFallbackName] = useState('');
  const [fallbackEmail, setFallbackEmail] = useState('');
  const [fallbackCompany, setFallbackCompany] = useState('');
  const [fallbackRole, setFallbackRole] = useState('');
  const [fallbackProblem, setFallbackProblem] = useState('');
  const [fallbackSubmitSuccess, setFallbackSubmitSuccess] = useState(false);
  const [fallbackError, setFallbackError] = useState('');

  // Vapi Voice Call States
  const [vapi, setVapi] = useState<any>(null);
  const [retellClient, setRetellClient] = useState<any>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [callStatus, setCallStatus] = useState('Disconnected');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [vapiLoaded, setVapiLoaded] = useState(false);

  const messageEndRef = useRef<HTMLDivElement | null>(null);

  // 1. Fetch Configuration & Setup Session
  useEffect(() => {
    // Generate unique session ID for tracking
    setSessionId(`sess-${Math.random().toString(36).substring(2, 11)}`);

    fetch(`/api/widget/config?client=${clientName}`)
      .then(res => {
        if (!res.ok) throw new Error('Config load failed');
        return res.json();
      })
      .then(data => {
        setConfig(data);
        // Add welcome message from config
        setMessages([
          { role: 'assistant', content: data.branding.welcomeMessage }
        ]);
      })
      .catch(err => {
        console.error("Config fetch failed:", err);
        setDegradedMode(true); // Fallback if config is unavailable
      });
  }, [clientName]);

  // 2. Load Vapi Web SDK dynamically
  useEffect(() => {
    if (!config?.vapi?.publicKey) return;

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@vapi-ai/web';
    script.async = true;
    script.onload = () => {
      setVapiLoaded(true);
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, [config]);

  // Load Retell Web Client SDK dynamically (avoiding SSR issues)
  useEffect(() => {
    if (config?.voice?.provider !== 'retell') return;

    import('retell-client-js-sdk')
      .then(({ RetellWebClient }) => {
        const client = new RetellWebClient();
        setRetellClient(client);

        client.on('call_started', () => {
          setIsCalling(true);
          setCallStatus('Connected');
          console.log("[Retell Voice] WebRTC Call connected.");
        });

        client.on('call_ended', () => {
          setIsCalling(false);
          setCallStatus('Disconnected');
          setIsVoiceMode(false);
          console.log("[Retell Voice] Call ended.");
        });

        client.on('error', (err) => {
          console.error('[Retell Voice] SDK error:', err);
          setCallStatus('Connection Failed');
          setIsCalling(false);
          setIsVoiceMode(false);
          alert("Voice assistant connection failed. Falling back to text chat.");
        });
      })
      .catch(err => {
        console.error("Failed to dynamically load Retell SDK:", err);
      });
  }, [config]);

  // Initialize Vapi Instance once SDK script is loaded
  useEffect(() => {
    if (vapiLoaded && (window as any).Vapi && config?.vapi?.publicKey) {
      try {
        const VapiConstructor = (window as any).Vapi;
        const vapiInstance = new VapiConstructor(config.vapi.publicKey);
        setVapi(vapiInstance);
        
        // Vapi Call Event listeners
        vapiInstance.on('call-start', () => {
          setIsCalling(true);
          setCallStatus('Connected');
          console.log("[Vapi Voice] Call connected successfully.");
        });

        vapiInstance.on('call-end', () => {
          setIsCalling(false);
          setCallStatus('Disconnected');
          setIsVoiceMode(false);
          console.log("[Vapi Voice] Call ended.");
        });

        vapiInstance.on('speech-start', () => {
          setCallStatus('Speaking');
        });

        vapiInstance.on('speech-end', () => {
          setCallStatus('Listening');
        });

        vapiInstance.on('message', (message: any) => {
          if (message.type === 'transcript') {
            const currentTranscript = `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.transcript}`;
            setVoiceTranscript(currentTranscript);
          }
        });

        vapiInstance.on('error', (err: any) => {
          console.error('[Vapi Voice] WebRTC error:', err);
          setCallStatus('Connection Failed');
          setIsCalling(false);
          setIsVoiceMode(false);
          // Graceful degradation: alert user and fall back to chat mode
          alert("Voice assistant is currently offline. Falling back to text chat.");
        });
      } catch (err) {
        console.error("Vapi initialization failed:", err);
      }
    }
  }, [vapiLoaded, config]);

  // 3. Listen to Dwell Time Trigger from Host page
  useEffect(() => {
    const handleDwellTrigger = (event: MessageEvent) => {
      // Auto open widget on trigger
      if (event.data?.type === 'trigger-dwell') {
        handleOpen();
      }
    };
    window.addEventListener('message', handleDwellTrigger);
    return () => window.removeEventListener('message', handleDwellTrigger);
  }, []);

  // 4. Listen to Cal.com Success postMessage events
  useEffect(() => {
    const handleCalBooking = (event: MessageEvent) => {
      if (event.data?.type === 'cal:bookingSuccessful') {
        console.log("[Cal.com Embed] Booking confirmed!");
        setCalBooked(true);

        // Find user email in conversation messages or fallback form to sync booking to HubSpot/leads
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
        let matchedEmail = fallbackEmail || '';
        if (!matchedEmail) {
          for (let i = messages.length - 1; i >= 0; i--) {
            const match = messages[i].content.match(emailRegex);
            if (match) {
              matchedEmail = match[0];
              break;
            }
          }
        }

        if (matchedEmail) {
          fetch('/api/widget/booking-confirmed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: matchedEmail })
          }).catch(err => console.error("Failed to sync HubSpot booking status:", err));
        }
        
        // Fire Google Ads Conversion event if configured
        if (config?.integrations?.googleAds?.conversionId) {
          const conversionId = config.integrations.googleAds.conversionId;
          const label = config.integrations.googleAds.conversionLabel || '';
          
          try {
            const gtagScript = document.createElement('script');
            gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${conversionId}`;
            document.head.appendChild(gtagScript);
            
            (window as any).dataLayer = (window as any).dataLayer || [];
            const gtag = function() { (window as any).dataLayer.push(arguments); };
            (window as any).gtag = gtag;
            // @ts-ignore
            gtag('js', new Date());
            // @ts-ignore
            gtag('config', conversionId);
            // @ts-ignore
            gtag('event', 'conversion', {
              'send_to': label ? `${conversionId}/${label}` : conversionId
            });
            console.log(`[Google Ads] Successfully fired booking conversion event for: ${conversionId}`);
          } catch (e) {
            console.error("Failed to load Google Ads gtag:", e);
          }
        }
      }
    };
    window.addEventListener('message', handleCalBooking);
    return () => window.removeEventListener('message', handleCalBooking);
  }, [config, messages, fallbackEmail]);

  // 5. Scroll chat to bottom on message updates
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, voiceTranscript]);

  const handleOpen = () => {
    setIsOpen(true);
    window.parent.postMessage({ type: 'toggle-open' }, '*');
  };

  const handleClose = () => {
    // End voice call if active
    if (vapi && isCalling) {
      vapi.stop();
    }
    if (retellClient && isCalling) {
      retellClient.stopCall();
    }
    setIsVoiceMode(false);
    setIsOpen(false);
    window.parent.postMessage({ type: 'toggle-close' }, '*');
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    const updatedMessages = [...messages, { role: 'user' as const, content: userMessage }];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/widget/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages,
          sessionId
        })
      });

      if (!response.ok) {
        // If API route fails, degrade to static Lead Form
        if (response.status === 503 || response.status === 500) {
          setDegradedMode(true);
        }
        throw new Error('Chat completions failed');
      }

      const data = await response.json();
      
      setMessages(prev => [...prev, { role: 'assistant', content: data.text }]);
      
      // If qualified as High Fit, trigger Cal.com view
      if (data.isHighFit) {
        setIsHighFit(true);
        // Resize iframe container to accommodate Cal.com scheduler
        window.parent.postMessage({ type: 'resize-calendar' }, '*');
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      // Fail gracefully: show network error
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "I'm having trouble connecting to our servers. Please use the form below to reach out directly!" 
      }]);
      setDegradedMode(true);
    } finally {
      setLoading(false);
    }
  };

  const handleFallbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFallbackError('');

    try {
      const res = await fetch('/api/widget/lead-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fallbackName,
          email: fallbackEmail,
          company: fallbackCompany,
          role: fallbackRole,
          problemStatement: fallbackProblem
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit form');
      }

      setFallbackSubmitSuccess(true);
    } catch (err: any) {
      setFallbackError(err.message || 'Submission failed. Please check your inputs.');
    }
  };

  const toggleVoiceMode = async () => {
    const provider = config?.voice?.provider || 'vapi';

    if (provider === 'retell') {
      if (!retellClient) {
        alert("Voice capabilities are currently loading or unavailable.");
        return;
      }

      if (isVoiceMode) {
        retellClient.stopCall();
        setIsVoiceMode(false);
      } else {
        setIsVoiceMode(true);
        setCallStatus('Connecting...');
        try {
          const res = await fetch('/api/widget/voice/register-retell', { method: 'POST' });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to initialize session');
          }
          const { accessToken } = await res.json();
          await retellClient.startCall({ accessToken });
        } catch (err: any) {
          console.error("Retell call initiation failed:", err);
          alert(`Call failed: ${err.message || 'Server error'}`);
          setIsVoiceMode(false);
        }
      }
      return;
    }

    // Default Vapi Flow
    if (!vapi || !config?.vapi?.assistantId) {
      alert("Voice capabilities are currently loading or unavailable.");
      return;
    }

    if (isVoiceMode) {
      vapi.stop();
      setIsVoiceMode(false);
    } else {
      setIsVoiceMode(true);
      setCallStatus('Connecting...');
      vapi.start(config.vapi.assistantId);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={handleOpen}
        className="w-[65px] h-[65px] rounded-full flex items-center justify-center cursor-pointer shadow-lg hover:scale-105 active:scale-95 transition-transform"
        style={{ backgroundColor: config?.branding?.primaryColor || '#1a33cc', border: 'none' }}
      >
        <MessageSquare className="w-8 h-8 text-white animate-pulse" />
      </button>
    );
  }

  const primaryBg = config?.branding?.primaryColor || '#1a33cc';
  const textColor = config?.branding?.textColor || '#0a0f2c';

  return (
    <div className="flex flex-col h-screen w-full bg-white shadow-2xl rounded-2xl overflow-hidden font-sans border border-gray-100">
      <style dangerouslySetInnerHTML={{ __html: `
        .markdown-content a {
          color: ${primaryBg};
          text-decoration: underline;
          font-weight: 600;
        }
        .markdown-content ul {
          list-style-type: disc;
          padding-left: 1.25rem;
          margin-top: 0.25rem;
          margin-bottom: 0.25rem;
        }
        .markdown-content ol {
          list-style-type: decimal;
          padding-left: 1.25rem;
          margin-top: 0.25rem;
          margin-bottom: 0.25rem;
        }
      `}} />
      
      {/* ── Header ── */}
      <div 
        className="px-4 py-3 flex items-center justify-between text-white shadow-sm shrink-0"
        style={{ backgroundColor: primaryBg }}
      >
        <div className="flex items-center gap-3">
          {config?.branding?.logoUrl ? (
            <img 
              src={config.branding.logoUrl} 
              alt="Logo" 
              className="w-8 h-8 rounded-full object-contain bg-white p-0.5"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold">E</div>
          )}
          <div>
            <h3 className="font-semibold text-sm leading-tight">
              {config?.branding?.assistantName || 'AI Assistant'}
            </h3>
            <p className="text-[10px] text-white/80 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-ping"></span>
              Online & ready
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Voice Mode Toggle (Only show if Vapi/Retell config exists and not in Cal.com/Degraded mode) */}
          {!isHighFit && !degradedMode && (config?.vapi?.assistantId || config?.voice?.provider === 'retell') && (
            <button
              onClick={toggleVoiceMode}
              className={`p-2 rounded-full border border-white/25 hover:bg-white/10 transition-colors cursor-pointer ${
                isVoiceMode ? 'bg-red-500 hover:bg-red-600 text-white border-none animate-pulse' : 'text-white'
              }`}
              title={isVoiceMode ? "Hang Up Call" : "Talk via Voice"}
            >
              {isVoiceMode ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
          
          <button 
            onClick={handleClose}
            className="p-1 hover:bg-white/10 rounded-full transition-colors cursor-pointer"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* ── Main Panel Body ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 bg-gray-50/50">
        
        {/* ── Case 1: Cal.com Inline Scheduler ── */}
        {isHighFit && (
          <div className="w-full h-full flex flex-col items-center justify-center space-y-3">
            {!calBooked ? (
              <>
                <div className="text-center px-2 shrink-0">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-2">
                    <Calendar className="w-5 h-5 text-[#1a33cc]" />
                  </div>
                  <h4 className="font-bold text-sm text-gray-900">Book Your Diagnostic Consultation</h4>
                  <p className="text-xs text-gray-500 mt-1">Select a timezone and convenient slot below to secure your 30-min session.</p>
                </div>
                <div className="flex-1 w-full min-h-[350px] border border-gray-100 rounded-xl overflow-hidden shadow-inner bg-white">
                  <iframe 
                    src={`https://cal.com/${config?.integrations?.cal?.eventLink}?embed=true`} 
                    style={{ width: '100%', height: '100%', border: 'none' }}
                    allow="calendar"
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto">
                  <Check className="w-10 h-10" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Consultation Booked!</h3>
                <p className="text-sm text-gray-600">
                  Dhananjay has received your booking. Check your email inbox for the meeting invitation and diagnostic details.
                </p>
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-xs text-gray-500 italic max-w-xs">
                  "Our paid diagnostic audits your tech stack, reviews engineering capabilities, and maps out agent requirements."
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Case 2: Outage / Degraded Mode Fallback Lead Form ── */}
        {degradedMode && !isHighFit && (
          <div className="w-full flex flex-col space-y-4">
            {!fallbackSubmitSuccess ? (
              <form onSubmit={handleFallbackSubmit} className="space-y-3 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex gap-2 items-start text-amber-600 mb-2">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-xs">
                    Our AI assistant is temporarily offline. Leave your details below and Dhananjay will follow up directly.
                  </p>
                </div>

                {fallbackError && (
                  <p className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">{fallbackError}</p>
                )}

                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={fallbackName}
                    onChange={e => setFallbackName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Work Email</label>
                  <input
                    type="email"
                    required
                    value={fallbackEmail}
                    onChange={e => setFallbackEmail(e.target.value)}
                    placeholder="john@company.com"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Company</label>
                  <input
                    type="text"
                    required
                    value={fallbackCompany}
                    onChange={e => setFallbackCompany(e.target.value)}
                    placeholder="MyCompany"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Job Role</label>
                  <input
                    type="text"
                    required
                    value={fallbackRole}
                    onChange={e => setFallbackRole(e.target.value)}
                    placeholder="CTO / VP Engineering"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Problem Statement</label>
                  <textarea
                    required
                    rows={3}
                    value={fallbackProblem}
                    onChange={e => setFallbackProblem(e.target.value)}
                    placeholder="Describe your AI agent / DevOps needs..."
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full text-white py-2 px-4 rounded-lg font-bold text-sm shadow hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                  style={{ backgroundColor: primaryBg }}
                >
                  Submit Details
                </button>
              </form>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto">
                  <Check className="w-10 h-10" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Lead Captured!</h3>
                <p className="text-sm text-gray-600">
                  Your request was registered. Dhananjay will reach out to you directly via your work email ({fallbackEmail}) shortly.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Case 3: Standard Conversational Chat View ── */}
        {!isHighFit && !degradedMode && (
          <>
            {/* Message Thread */}
            {messages.map((msg, i) => (
              <div 
                key={i} 
                className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
              >
                <div 
                  className={`px-3 py-2 rounded-2xl text-sm shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-blue-600 text-white rounded-br-none' 
                      : 'bg-white text-gray-800 rounded-bl-none border border-gray-100'
                  }`}
                  style={msg.role === 'user' ? { backgroundColor: primaryBg } : undefined}
                >
                  {msg.role === 'user' ? (
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  ) : (
                    <div className="markdown-content prose prose-sm leading-relaxed whitespace-pre-wrap text-sm">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Voice Mode Transcript display */}
            {isVoiceMode && isCalling && (
              <div className="w-full bg-blue-50 border border-blue-100 p-3 rounded-xl flex flex-col space-y-2 animate-pulse">
                <div className="flex items-center justify-between text-xs text-blue-700 font-semibold">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>
                    Call State: {callStatus}
                  </span>
                  <span>Voice Active</span>
                </div>
                <div className="text-xs text-gray-600 italic font-mono bg-white p-2 rounded border">
                  {voiceTranscript || 'Speaking/Listening... Transcript will load here.'}
                </div>
              </div>
            )}

            {loading && (
              <div className="flex mr-auto items-center gap-1.5 bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
            )}
            
            <div ref={messageEndRef} />
          </>
        )}
      </div>

      {/* ── Chat Footer Input Area ── */}
      {!isHighFit && !degradedMode && (
        <div className="p-3 border-t shrink-0 bg-white">
          {/* Quick Booking CTA Link */}
          <div className="flex justify-between items-center mb-2 px-1 text-xs text-gray-400">
            <span>Direct contact</span>
            <button 
              onClick={() => {
                setIsHighFit(true);
                window.parent.postMessage({ type: 'resize-calendar' }, '*');
              }}
              className="text-[#1a33cc] font-semibold hover:underline flex items-center gap-0.5 cursor-pointer bg-transparent border-none"
              style={{ color: primaryBg }}
            >
              Book call directly <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <form onSubmit={handleTextSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              disabled={loading || isVoiceMode}
              onChange={e => setInput(e.target.value)}
              placeholder={isVoiceMode ? 'Call in progress. Hang up to type...' : 'Type your message...'}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-full text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim() || isVoiceMode}
              className="p-2.5 rounded-full text-white flex items-center justify-center shadow-md disabled:opacity-40 disabled:pointer-events-none cursor-pointer border-none"
              style={{ backgroundColor: primaryBg }}
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function WidgetPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen w-full items-center justify-center text-xs text-gray-400 bg-white">
        Loading assistant...
      </div>
    }>
      <WidgetContent />
    </Suspense>
  );
}
