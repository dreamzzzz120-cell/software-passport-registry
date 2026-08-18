/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Sparkles, LogOut, CheckCircle, HelpCircle, Laptop, Sun, Moon, Shield, Key, Menu } from 'lucide-react';
import { Client } from '../types';
import { auth, signOut } from '../lib/firebase';

interface HeaderProps {
  clients: Client[];
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
  onOpenQuickAction: (actionType: 'add-client' | 'register-passport' | 'scan-sbom') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  user: any; // Firebase User
  userRole: string; // From database user sync
  onChangeRole: (newRole: string) => void; // Interactive RBAC switcher
  onToggleMobileMenu: () => void; // Trigger callback for mobile menu drawer
  onStartTutorial: () => void;
}

export default function Header({
  clients,
  selectedClientId,
  setSelectedClientId,
  onOpenQuickAction,
  searchQuery,
  setSearchQuery,
  theme,
  toggleTheme,
  user,
  userRole,
  onChangeRole,
  onToggleMobileMenu,
  onStartTutorial
}: HeaderProps) {
  const [showActionsDropdown, setShowActionsDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  
  const selectedClient = clients.find(c => c.id === selectedClientId);

  const handleLogout = async () => {
    try {
      localStorage.removeItem('msp_user');
      await signOut(auth).catch(() => {});
      window.location.reload();
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const getInitials = (name: string = '') => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  };

  return (
    <header className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-b border-slate-100 dark:border-zinc-800/50 h-16 px-6 flex items-center justify-between shrink-0 z-30 select-none transition-colors duration-300">
      {/* Hamburger menu for mobile screen sizes */}
      <button
        onClick={onToggleMobileMenu}
        className="lg:hidden p-2 mr-2 -ml-2 rounded-xl text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800/40 cursor-pointer flex items-center justify-center shrink-0"
        aria-label="Open Navigation Menu"
        id="mobile-hamburger-trigger"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Search and context title */}
      <div className="flex items-center gap-6 flex-1 max-w-xl">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search passports, CVE IDs, vendors, or clients..."
            className="w-full studio-input pl-10 pr-4 py-2 text-xs font-sans placeholder-slate-400"
            id="global-search-input"
          />
        </div>
      </div>

      {/* Right control utilities */}
      <div className="flex items-center gap-4">
        {/* Quick context info */}
        <div className="hidden lg:flex items-center gap-2 border-r border-slate-100 dark:border-zinc-800/80 pr-4 text-right">
          <div>
            <p className="text-[10px] text-slate-400 font-mono tracking-wider">WORKSPACE CONTEXT</p>
            <p className="text-xs font-bold text-slate-700 dark:text-zinc-200">
              {selectedClientId === 'global' ? 'Global Multi-Tenant Hub' : selectedClient?.name}
            </p>
          </div>
        </div>

        {/* Interactive RBAC Role Selector Widget */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs">
          <Shield className="w-3.5 h-3.5 text-indigo-500" />
          <span className="font-mono text-[10px] text-slate-400 font-bold uppercase mr-1">RBAC:</span>
          <select
            value={userRole}
            onChange={(e) => onChangeRole(e.target.value)}
            className="bg-transparent text-slate-700 dark:text-zinc-200 focus:outline-none font-bold text-[11px] cursor-pointer"
            id="rbac-role-switcher"
            title="Switch roles to test access privileges on backend endpoints"
          >
            <option value="Platform Owner">Platform Owner</option>
            <option value="Enterprise Admin">Enterprise Admin</option>
            <option value="Security Officer">Security Officer</option>
            <option value="Compliance Officer">Compliance Officer</option>
            <option value="Developer">Developer</option>
            <option value="Auditor">Auditor (Read Only)</option>
            <option value="Viewer">Viewer (Read Only)</option>
          </select>
        </div>

        {/* Dark Mode Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2.5 rounded-xl border border-slate-100 dark:border-zinc-800/80 text-slate-500 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800/40 hover:text-slate-700 dark:hover:text-zinc-200 transition-all cursor-pointer overflow-hidden flex items-center justify-center h-9 w-9"
          aria-label="Toggle Theme"
          id="global-theme-toggle"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={theme}
              initial={{ rotate: -180, scale: 0.5, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={{ rotate: 180, scale: 0.5, opacity: 0 }}
              transition={{
                type: 'spring',
                stiffness: 220,
                damping: 15,
                mass: 0.8
              }}
              className="flex items-center justify-center shrink-0"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-500 shrink-0" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-500 shrink-0" />
              )}
            </motion.div>
          </AnimatePresence>
        </button>

        {/* Tutorial / Help Center Trigger */}
        <button
          onClick={onStartTutorial}
          className="p-2.5 rounded-xl border border-slate-100 dark:border-zinc-800/80 text-slate-500 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800/40 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all cursor-pointer flex items-center justify-center h-9 w-9"
          title="Launch Platform Tour"
          id="global-tutorial-toggle"
        >
          <HelpCircle className="w-4 h-4 text-indigo-500 animate-pulse shrink-0" />
        </button>

        {/* Action button dropdown */}
        <div className="relative">
            <button
              onClick={() => setShowActionsDropdown(!showActionsDropdown)}
              className="spr-btn-primary px-4 py-2 flex items-center gap-2"
              id="quick-actions-trigger"
            >
              <Plus className="w-4 h-4" />
              <span>SPR Action</span>
            </button>

            {showActionsDropdown && (
              <div className="absolute right-0 mt-2.5 w-60 studio-dropdown py-2.5 z-50">
                <div className="px-3.5 pb-2 border-b border-slate-100 dark:border-zinc-800/80 mb-1.5">
                  <span className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">Rapid Trust Actions</span>
                </div>
                <button
                  onClick={() => {
                    onOpenQuickAction('register-passport');
                    setShowActionsDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2.5 text-xs text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800/40 hover:text-slate-900 dark:hover:text-zinc-100 flex items-center gap-2.5 cursor-pointer transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                  <span className="font-medium">Issue Software Passport</span>
                </button>
                <button
                  onClick={() => {
                    onOpenQuickAction('scan-sbom');
                    setShowActionsDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2.5 text-xs text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800/40 hover:text-slate-900 dark:hover:text-zinc-100 flex items-center gap-2.5 cursor-pointer transition-colors"
                >
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="font-medium">Verify CycloneDX / SPDX SBOM</span>
                </button>
                <button
                  onClick={() => {
                    onOpenQuickAction('add-client');
                    setShowActionsDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2.5 text-xs text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800/40 hover:text-slate-900 dark:hover:text-zinc-100 flex items-center gap-2.5 cursor-pointer transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-blue-500" />
                  <span className="font-medium">Onboard Enterprise Organization</span>
                </button>
              </div>
            )}
        </div>

        {/* User Identity Profile Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowProfileDropdown(!showProfileDropdown)}
            className="flex items-center gap-2 border-l border-slate-200 dark:border-zinc-800 pl-4 focus:outline-none text-left cursor-pointer hover:opacity-85 transition"
            id="user-profile-trigger"
          >
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                referrerPolicy="no-referrer"
                alt="Avatar"
                className="w-8 h-8 rounded-full border border-slate-200 dark:border-zinc-700 shadow-sm"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-xs font-semibold">
                {getInitials(user?.displayName || user?.email)}
              </div>
            )}
            <div className="hidden sm:block">
              <p className="text-xs font-bold text-slate-700 dark:text-zinc-200">
                {user?.displayName || 'MSP Administrator'}
              </p>
              <p className="text-[9px] font-mono text-slate-400 dark:text-zinc-400 truncate max-w-[120px]">
                {user?.email}
              </p>
            </div>
          </button>

          {showProfileDropdown && (
            <div className="absolute right-0 mt-2.5 w-60 studio-dropdown py-2 z-50">
              <div className="px-4 py-2 border-b border-slate-100 dark:border-zinc-800/80 mb-2">
                <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Account Active</p>
                <p className="text-xs font-bold text-slate-800 dark:text-zinc-100 mt-1 truncate">
                  {user?.displayName || 'MSP User'}
                </p>
                <p className="text-[10px] font-mono text-slate-400 truncate">
                  {user?.email}
                </p>
              </div>

              <div className="px-4 py-1.5 text-[10px] font-mono text-slate-400 flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-indigo-500" />
                <span>TENANT CONTEXT:</span>
              </div>
              <div className="px-4 pb-2 mb-2 border-b border-slate-100 dark:border-zinc-800/80 text-[11px] font-bold text-slate-700 dark:text-zinc-200 font-mono truncate">
                tenant-{user?.email?.split('@')[1] || 'default'}
              </div>

              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 flex items-center gap-2.5 cursor-pointer font-medium transition"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-500" />
                <span>Sign Out Securely</span>
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
