/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ShieldAlert, User, Calendar, FileText, CheckCircle, X, Save } from 'lucide-react';
import { Vulnerability } from '../types';

interface RiskMitigationProps {
  vulnerability: Vulnerability;
  onSave: (
    plan: string,
    owner: string,
    targetDate: string,
    status: 'Open' | 'Mitigated' | 'Resolved' | 'Snoozed'
  ) => void;
  onCancel: () => void;
}

export default function RiskMitigation({
  vulnerability,
  onSave,
  onCancel
}: RiskMitigationProps) {
  const [plan, setPlan] = useState(vulnerability.mitigationPlan || '');
  const [owner, setOwner] = useState(vulnerability.mitigationOwner || '');
  const [targetDate, setTargetDate] = useState(vulnerability.mitigationTargetDate || '');
  const [status, setStatus] = useState<'Open' | 'Mitigated' | 'Resolved' | 'Snoozed'>(
    vulnerability.status
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(plan, owner, targetDate, status);
  };

  const severityColors = {
    Critical: 'bg-rose-100 text-rose-800 border-rose-200',
    High: 'bg-amber-100 text-amber-800 border-amber-200',
    Medium: 'bg-blue-100 text-blue-800 border-blue-200',
    Low: 'bg-slate-100 text-slate-800 border-slate-200'
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4.5 space-y-4 animate-fade-in">
      <div className="flex justify-between items-start pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-indigo-600" />
          <div>
            <h4 className="text-xs font-bold text-slate-900 font-display flex items-center gap-1.5">
              <span>Risk Remediation Plan</span>
              <span className="text-[10px] text-slate-400 font-mono">({vulnerability.id})</span>
            </h4>
            <p className="text-[10px] text-slate-500 mt-0.5">{vulnerability.title}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {/* Row 1: Owner & Target Date */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-slate-700 flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>Assigned Owner</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Alice Vance (Security Lead)"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="bg-white border border-slate-250 rounded-lg p-2 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-semibold text-slate-700 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Target Completion Date</span>
            </label>
            <input
              type="date"
              required
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="bg-white border border-slate-250 rounded-lg p-2 focus:outline-none focus:border-indigo-500 transition-colors font-mono cursor-pointer"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-semibold text-slate-700 flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5 text-slate-400" />
              <span>Vulnerability Status</span>
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="bg-white border border-slate-250 rounded-lg p-2 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer font-medium text-slate-800"
            >
              <option value="Open">Open (Active Risk)</option>
              <option value="Mitigated">Mitigated (Plan active)</option>
              <option value="Resolved">Resolved (Patched/Remediated)</option>
              <option value="Snoozed">Snoozed (Accepted risk)</option>
            </select>
          </div>
        </div>

        {/* Row 2: Action Details Plan */}
        <div className="flex flex-col gap-1">
          <label className="font-semibold text-slate-700 flex items-center gap-1">
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span>Remediation & Mitigation Plan</span>
          </label>
          <textarea
            required
            rows={3}
            placeholder="Outline the mitigation steps, fallback controls, patch deployment schedule, or validation criteria..."
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="bg-white border border-slate-250 rounded-lg p-2.5 focus:outline-none focus:border-indigo-500 transition-colors leading-relaxed resize-none"
          />
        </div>

        {/* Form Actions */}
        <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 hover:bg-slate-200 border border-slate-300 rounded-lg text-slate-600 text-xs font-semibold cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer transition-colors flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Mitigation Plan</span>
          </button>
        </div>
      </form>
    </div>
  );
}
