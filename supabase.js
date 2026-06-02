// supabase.js — single Supabase client for the entire app
// Load order on every page: CDN → supabase.js → auth.js → navbar.js → page script

var SUPA_URL  = 'https://zaptzjohvgwayvytntyb.supabase.co';
var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphcHR6am9odmd3YXl2eXRudHliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2Njc5NjgsImV4cCI6MjA5NTI0Mzk2OH0.KIGpHpUM1NfC19_Xmz4QpS4hSEVonA4xOy9V_vFgFe4';

// window.sb is the one shared client — never call createClient anywhere else
window.sb = window.supabase.createClient(SUPA_URL, SUPA_ANON, {
  auth: {
    persistSession: true,        // store session in localStorage
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'anestheo-auth'
  }
});

// Storage availability probe (rules out "session can't be saved" environments)
try {
  window.localStorage.setItem('anestheo-probe', '1');
  window.localStorage.removeItem('anestheo-probe');
  console.log('STORAGE OK — localStorage writable');
} catch(e) {
  console.error('STORAGE BLOCKED — localStorage not writable:', e.message,
    '\\nSessions cannot persist in this context (private mode / blocked cookies / storage partitioning).');
}
