
import React from 'react';

export const COLORS = {
  primary: '#4f46e5', // indigo-600
  secondary: '#10b981', // emerald-500
  accent: '#f59e0b', // amber-500
  background: '#f8fafc', // slate-50
};

export const Icons = {
  Dashboard: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
  ),
  Agent: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a5 5 0 1 0 5 5 5 5 0 0 0-5-5Z"/><path d="M17 21v-2a4 4 0 0 0-4-4H11a4 4 0 0 0-4 4v2"/></svg>
  ),
  Surface: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
  ),
  Analytics: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
  ),
  Settings: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2 2 2 0 0 1-2 2 2 2 0 0 0-2 2 2 2 0 0 1-2 2 2 2 0 0 0-2 2v.44a2 2 0 0 0 2 2 2 2 0 0 1 2 2 2 2 0 0 0 2 2 2 2 0 0 1 2 2 2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2 2 2 0 0 1 2-2 2 2 0 0 0 2-2 2 2 0 0 1 2-2 2 2 0 0 0 2-2v-.44a2 2 0 0 0-2-2 2 2 0 0 1-2-2 2 2 0 0 0-2-2 2 2 0 0 1-2-2 2 2 0 0 0-2-2ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg>
  ),
  Plus: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
  )
};
