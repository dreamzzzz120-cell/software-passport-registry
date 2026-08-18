/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Client, SoftwarePassport, EvidenceItem, Vulnerability } from '../types';

export function generateClientCompliancePDF(client: Client) {
  // Create instance of jsPDF in A4 format (210 x 297 mm)
  const doc = new jsPDF('p', 'mm', 'a4');
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  // Margins & positioning vars
  const startX = 15;
  let currentY = 15;

  // --- PAGE 1: TITLE BANNER ---
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(startX, currentY, 180, 26, 'F');

  // Title Text inside Banner
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('MSP SECURITY REGISTRY', startX + 6, currentY + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text('COMPLIANCE AUDIT PORTFOLIO & HISTORIC TRAIL', startX + 6, currentY + 17);

  // SLA Stamp on the Right of Banner
  doc.setFillColor(79, 70, 229); // indigo-600
  doc.rect(142, currentY + 6, 45, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('REPORT STATE: REVIEW', 145, currentY + 11);
  doc.setFont('helvetica', 'normal');
  doc.text('EVIDENCE STATUS PER RECORD', 145, currentY + 16);

  currentY += 34;

  // --- CLIENT INFORMATION SECTION ---
  doc.setTextColor(30, 41, 59); // slate-800
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. TENANT PROFILE COORDINATES', startX, currentY);

  // Underline
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.5);
  doc.line(startX, currentY + 2, startX + 180, currentY + 2);

  currentY += 7;

  // Render Tenant Profile Grid (Simulated 2-column list)
  doc.setFillColor(248, 250, 252); // slate-50
  doc.rect(startX, currentY, 180, 24, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.rect(startX, currentY, 180, 24, 'S');

  doc.setTextColor(100, 116, 139); // slate-500
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  
  // Left col headers
  doc.text('ORGANIZATION NAME:', startX + 4, currentY + 6);
  doc.text('REGISTERED DOMAIN:', startX + 4, currentY + 12);
  doc.text('INDUSTRY SEGMENT:', startX + 4, currentY + 18);

  // Right col headers
  doc.text('REGISTRY CONTRACT TIER:', startX + 90, currentY + 6);
  doc.text('ONBOARDING DATE:', startX + 90, currentY + 12);
  doc.text('STAKEHOLDER OPERATORS:', startX + 90, currentY + 18);

  // Fill actual details
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(client.name, startX + 38, currentY + 6);
  doc.setFont('courier', 'normal');
  doc.text(client.domain, startX + 38, currentY + 12);
  doc.setFont('helvetica', 'normal');
  doc.text(client.industry, startX + 38, currentY + 18);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(79, 70, 229); // Indigo color for tier
  doc.text(client.subscriptionTier.toUpperCase(), startX + 134, currentY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(client.joinedDate, startX + 134, currentY + 12);
  doc.text(`${client.teamMembers.length} Registered Stakeholders`, startX + 134, currentY + 18);

  currentY += 32;

  // --- EXECUTIVE POSTURE METRICS ---
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('2. SECURITY POSTURE STATUS', startX, currentY);
  doc.line(startX, currentY + 2, startX + 180, currentY + 2);

  currentY += 7;

  // Bento Box Metrics (4 cards)
  const cardW = 42;
  const cardH = 20;
  const gap = 4;

  const metrics = [
    { label: 'TRUST SCORE', val: `${client.trustScore}/100`, status: client.riskLevel + ' Risk', color: client.riskLevel === 'Safe' ? [16, 185, 129] : [245, 158, 11] },
    { label: 'COMPLIANCE PROGRESS', val: `${client.complianceProgress}%`, status: 'Unverified progress indicator', color: [79, 70, 229] },
    { label: 'PASSPORTS IN USE', val: `${client.softwareInventory.length}`, status: 'Configured inventory', color: [13, 148, 136] },
    { label: 'CRITICAL RISKS', val: `${client.criticalRisksCount}`, status: client.criticalRisksCount > 0 ? 'Action Required' : 'Guarded', color: client.criticalRisksCount > 0 ? [239, 68, 68] : [16, 185, 129] },
  ];

  metrics.forEach((m, idx) => {
    const x = startX + idx * (cardW + gap);
    // Draw box
    doc.setFillColor(248, 250, 252);
    doc.rect(x, currentY, cardW, cardH, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.rect(x, currentY, cardW, cardH, 'S');

    // Label
    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text(m.label, x + 3, currentY + 5);

    // Value
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(13);
    doc.text(m.val, x + 3, currentY + 12);

    // Status
    doc.setTextColor(m.color[0], m.color[1], m.color[2]);
    doc.setFontSize(6.5);
    doc.text(m.status, x + 3, currentY + 17);
  });

  currentY += 27;

  // --- SECTION 3: COMPLIANCE STANDARD RATINGS ---
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('3. COMPLIANCE FRAMEWORKS & STATUS', startX, currentY);
  doc.line(startX, currentY + 2, startX + 180, currentY + 2);

  currentY += 6;

  // Generate frameworks table
  const frameworksRows = client.complianceStatus.map(f => [
    f.code,
    f.name,
    `${f.progress}%`,
    `${f.compliantControls} / ${f.totalControls}`,
    f.status
  ]);

  autoTable(doc, {
    startY: currentY,
    head: [['Framework Code', 'Framework Standard Name', 'Reported Progress', 'Reported Controls', 'Reported Status']],
    body: frameworksRows,
    theme: 'striped',
    headStyles: { fillColor: [79, 70, 229], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, font: 'helvetica' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 25 },
      1: { cellWidth: 75 },
      2: { fontStyle: 'bold', cellWidth: 20 },
      3: { cellWidth: 35 },
      4: { fontStyle: 'bold', cellWidth: 25 }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) data.cell.styles.textColor = [100, 116, 139];
    }
  });

  // Shift current Y coordinate down based on the drawn table
  currentY = (doc as any).lastAutoTable.finalY + 10;

  // --- SECTION 4: CORE SOFTWARE INVENTORY PASSPORTS ---
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('4. SOFTWARE PASSPORT INVENTORY', startX, currentY);
  doc.line(startX, currentY + 2, startX + 180, currentY + 2);

  currentY += 6;

  const inventoryRows = client.softwareInventory.map(item => [
    item.name,
    item.version,
    item.lastScanDate,
    `${item.overallScore} / 100`,
    item.riskStatus
  ]);

  autoTable(doc, {
    startY: currentY,
    head: [['Software Component', 'Deployed Version', 'Last Scanned', 'Trust Score', 'Rating']],
    body: inventoryRows,
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, font: 'helvetica' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 65 },
      1: { font: 'courier', fontSize: 7.5, cellWidth: 25 },
      2: { cellWidth: 35 },
      3: { fontStyle: 'bold', cellWidth: 25 },
      4: { fontStyle: 'bold', cellWidth: 30 }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) {
        const text = String(data.cell.raw);
        if (text === 'Safe') {
          data.cell.styles.textColor = [16, 185, 129];
        } else if (text === 'Warning') {
          data.cell.styles.textColor = [217, 119, 6];
        } else {
          data.cell.styles.textColor = [220, 38, 38];
        }
      }
    }
  });

  // Shift Y down for page breaks or next section
  currentY = (doc as any).lastAutoTable.finalY + 10;

  // Check if we need to add a new page or have sufficient space (e.g. 80mm required)
  if (currentY > 210) {
    doc.addPage();
    currentY = 20;
  }

  // --- SECTION 5: HISTORIC AUDIT TIMELINE ---
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('5. COMPLIANCE & HISTORIC AUDIT TRAIL', startX, currentY);
  doc.line(startX, currentY + 2, startX + 180, currentY + 2);

  currentY += 6;

  // Chronological timeline
  const timelineRows = client.activityTimeline.map(log => [
    log.timestamp.replace('T', ' ').substring(0, 16),
    log.eventType,
    log.user,
    log.severity,
    log.description
  ]);

  autoTable(doc, {
    startY: currentY,
    head: [['Date / Time', 'Audit Event Type', 'Operator', 'Severity', 'SLA Description']],
    body: timelineRows,
    theme: 'striped',
    headStyles: { fillColor: [13, 148, 136], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.5, font: 'helvetica' },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { fontStyle: 'bold', cellWidth: 35 },
      2: { cellWidth: 25 },
      3: { fontStyle: 'bold', cellWidth: 20 },
      4: { cellWidth: 70 }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 3) {
        const text = String(data.cell.raw);
        if (text === 'Critical') {
          data.cell.styles.textColor = [220, 38, 38];
        } else if (text === 'High') {
          data.cell.styles.textColor = [217, 119, 6];
        } else if (text === 'Medium') {
          data.cell.styles.textColor = [79, 70, 229];
        } else {
          data.cell.styles.textColor = [100, 116, 139];
        }
      }
    }
  });

  // --- POST-PROCESSING FOR DYNAMIC FOOTER/HEADER PAGINATION ---
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    
    // Bottom rule and footer text
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.4);
    doc.line(startX, 282, startX + 180, 282);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text('CONFIDENTIAL - CLIENT-FACING SECURITY AUDIT REPORT', startX, 286);
    doc.text(`REPORT RUNTIME: ${timestamp}`, startX, 290);
    
    doc.setFont('helvetica', 'bold');
    doc.text(`Page ${i} of ${pageCount}`, startX + 163, 286);
    doc.setFont('helvetica', 'normal');
    doc.text('MSP Registry System', startX + 158, 290);
  }

  // Save the PDF locally on the browser side with client name slug
  const clientSlug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`security-compliance-audit-${clientSlug}.pdf`);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const fullHex = hex.replace(shorthandRegex, (_m, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 79, g: 70, b: 229 }; // default indigo
}

export function generateCoBrandedTrustReport(
  client: Client,
  mspName: string,
  brandColorHex: string,
  customTitle: string,
  patchedCvesCount: number,
  executiveSummary: string,
  logoBase64?: string,
  includeSummary: boolean = true,
  includeMetrics: boolean = true,
  includeInventory: boolean = true,
  includeComplianceChecklist: boolean = true,
  includeSignatures: boolean = true,
  selectedAssetNames: string[] = []
) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  const rgb = hexToRgb(brandColorHex);

  const startX = 15;
  let currentY = 15;

  // --- PAGE 1: HERO CO-BRANDED COVER BLOCK ---
  doc.setFillColor(rgb.r, rgb.g, rgb.b);
  doc.rect(startX, currentY, 180, 42, 'F');

  // Co-brand Partner Info Bar
  doc.setFillColor(15, 23, 42); // slate-900 background
  doc.rect(startX + 6, currentY + 6, 125, 8, 'F');
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text(`SECURITY AUDIT PARTNERSHIP: ${mspName.toUpperCase()}  x  ${client.name.toUpperCase()}`, startX + 10, currentY + 11.5);

  // Main Report Title
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text(customTitle.toUpperCase() || 'SOFTWARE TRUST & COMPLIANCE LEDGER', startX + 6, currentY + 23);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(186, 230, 253); // light cyan-200
  doc.text(`Continuous integrity check & pedigree ledger provided by ${mspName}`, startX + 6, currentY + 29);
  doc.setTextColor(255, 255, 255);
  doc.text(`Generated: ${timestamp}`, startX + 6, currentY + 34);

  // Draw custom logo if uploaded by user
  if (logoBase64) {
    try {
      // Background for custom logo to look crisp
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(startX + 140, currentY + 6, 34, 30, 2, 2, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(startX + 140, currentY + 6, 34, 30, 2, 2, 'S');
      
      // Determine format (PNG or JPEG) based on Base64 string prefix
      let format = 'PNG';
      if (logoBase64.includes('image/jpeg') || logoBase64.includes('image/jpg')) {
        format = 'JPEG';
      } else if (logoBase64.includes('image/webp')) {
        format = 'WEBP';
      }
      
      doc.addImage(logoBase64, format, startX + 142, currentY + 8, 30, 26);
    } catch (err) {
      console.error('Error drawing custom logo in PDF:', err);
    }
  } else {
    // Elegant placeholder seal if no logo
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.5);
    doc.circle(startX + 157, currentY + 21, 10, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('EVIDENCE', startX + 150.5, currentY + 20);
    doc.setFontSize(5);
    doc.text('STATUS', startX + 151.8, currentY + 23.5);
  }

  currentY += 52;

  // --- EXECUTIVE SUMMARY SECTION ---
  if (includeSummary) {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('1. EXECUTIVE SUMMARY & MSP RISK SUMMARY', startX, currentY);

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.line(startX, currentY + 2, startX + 180, currentY + 2);

    currentY += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105); // slate-600
    
    const textLines = doc.splitTextToSize(
      executiveSummary || `No executive analysis was generated for ${client.name}. Review the evidence and metrics in this report directly; no continuous-monitoring or compliance claim is implied.`,
      176
    );
    doc.text(textLines, startX, currentY);

    currentY += (textLines.length * 4.5) + 6;
  }

  // --- KEY METRICS POSTURE BOARD ---
  if (includeMetrics) {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('2. CORE POSTURE STATS', startX, currentY);
    doc.line(startX, currentY + 2, startX + 180, currentY + 2);

    currentY += 7;

    const cardW = 42;
    const cardH = 20;
    const gap = 4;

    const metrics = [
      { label: 'CLIENT TRUST SCORE', val: `${client.trustScore}/100`, sub: `${client.riskLevel} Risk Profile`, color: client.riskLevel === 'Safe' ? [16, 185, 129] : [245, 158, 11] },
      { label: 'ACTIVE PASSPORTS', val: `${client.softwareInventory.length} Active`, sub: 'Evidence status per record', color: [rgb.r, rgb.g, rgb.b] },
      { label: 'PATCHED VULNS (CVE)', val: `${patchedCvesCount} Patched`, sub: 'Remediated past 30 days', color: [16, 185, 129] },
      { label: 'UNRESOLVED ALERTS', val: `${client.criticalRisksCount}`, sub: client.criticalRisksCount > 0 ? 'Action Required' : 'Guarded', color: client.criticalRisksCount > 0 ? [239, 68, 68] : [16, 185, 129] },
    ];

    metrics.forEach((m, idx) => {
      const x = startX + idx * (cardW + gap);
      doc.setFillColor(248, 250, 252);
      doc.rect(x, currentY, cardW, cardH, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.rect(x, currentY, cardW, cardH, 'S');

      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.text(m.label, x + 3, currentY + 5);

      doc.setTextColor(15, 23, 42);
      doc.setFontSize(11);
      doc.text(m.val, x + 3, currentY + 12);

      doc.setTextColor(m.color[0], m.color[1], m.color[2]);
      doc.setFontSize(6);
      doc.text(m.sub, x + 3, currentY + 17);
    });

    currentY += 28;
  }

  // --- SOFTWARE INVENTORY RATINGS TABLE ---
  if (includeInventory) {
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('3. COMPLIANT SOFTWARE PASSPORT INVENTORY', startX, currentY);
    doc.line(startX, currentY + 2, startX + 180, currentY + 2);

    currentY += 6;

    // Filter by selected assets if configured, otherwise include all
    const filteredInventory = selectedAssetNames.length > 0
      ? client.softwareInventory.filter(item => selectedAssetNames.includes(item.name))
      : client.softwareInventory;

    const inventoryRows = filteredInventory.length > 0 ? filteredInventory.map(item => [
      item.name,
      item.version,
      item.lastScanDate,
      `${item.overallScore} / 100`,
      item.riskStatus
    ]) : [['No software items matched or selected', '-', '-', '-', '-']];

    autoTable(doc, {
      startY: currentY,
      head: [['Audited Software Component', 'Version', 'Last Scan Run', 'Passport Score', 'Compliance Rating']],
      body: inventoryRows,
      theme: 'striped',
      headStyles: { fillColor: [rgb.r, rgb.g, rgb.b], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5, font: 'helvetica' },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 65 },
        1: { font: 'courier', fontSize: 7.5, cellWidth: 22 },
        2: { cellWidth: 35 },
        3: { fontStyle: 'bold', cellWidth: 28 },
        4: { fontStyle: 'bold', cellWidth: 30 }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const text = String(data.cell.raw);
          if (text === 'Safe') {
            data.cell.styles.textColor = [16, 185, 129];
          } else if (text === 'Warning') {
            data.cell.styles.textColor = [217, 119, 6];
          } else if (text === 'Danger' || text === 'Critical') {
            data.cell.styles.textColor = [220, 38, 38];
          }
        }
      }
    });

    currentY = (doc as any).lastAutoTable.finalY + 10;
  }

  // --- NIST & SOC-2 COMPLIANCE CHECKLIST ---
  if (includeComplianceChecklist) {
    if (currentY > 210) {
      doc.addPage();
      currentY = 25;
    }

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('4. NIST SP 800-161 & SOC-2 SUPPLY-CHAIN CONTROLS', startX, currentY);
    doc.line(startX, currentY + 2, startX + 180, currentY + 2);

    currentY += 7;

    const checklistRows = [
      ['NIST.SC-1', 'Cryptographic Signature Verification', 'Requires evidence-backed signature validation for the reported asset.', 'NOT ASSESSED'],
      ['NIST.SC-3', 'SBOM Inventory', 'Requires persisted SBOM evidence for the reported asset.', 'NOT ASSESSED'],
      ['NIST.SC-5', 'Vulnerability Mapping', 'Requires persisted provider results for the reported asset.', 'NOT ASSESSED'],
      ['SOC2.CC-6', 'Tenant Separation', 'Requires a server-side tenant-isolation verification.', 'NOT ASSESSED'],
      ['SOC2.CC-8', 'Evidence History', 'Requires persisted integrity and history evidence.', 'NOT ASSESSED'],
      ['SOC2.A-1', 'Response Controls', 'Requires evidence of an executed response control.', 'NOT ASSESSED']
    ];

    autoTable(doc, {
      startY: currentY,
      head: [['Control ID', 'Regulatory Objective', 'Operational Enforcement Method', 'Audit Status']],
      body: checklistRows,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], fontSize: 7.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7, font: 'helvetica' },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 18 },
        1: { fontStyle: 'bold', cellWidth: 48 },
        2: { cellWidth: 84 },
        3: { fontStyle: 'bold', cellWidth: 30 }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 3) {
          data.cell.styles.textColor = [100, 116, 139];
        }
      }
    });

    currentY = (doc as any).lastAutoTable.finalY + 10;
  }

  // --- SIGNATURE SECTION ---
  if (includeSignatures) {
    if (currentY > 230) {
      doc.addPage();
      currentY = 25;
    }

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    const stepNum = (includeSummary ? 1 : 0) + (includeMetrics ? 1 : 0) + (includeInventory ? 1 : 0) + (includeComplianceChecklist ? 1 : 0);
    doc.text(`${stepNum}. SIGNATURE DELIVERY DEED & ATTESTATION`, startX, currentY);
    doc.line(startX, currentY + 2, startX + 180, currentY + 2);

    currentY += 8;

    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.3);
    doc.line(startX + 5, currentY + 12, startX + 75, currentY + 12);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('AUTHORIZED MSP SIGN-OFF', startX + 5, currentY + 16);
    doc.setFont('helvetica', 'normal');
    doc.text(`Signee representing: ${mspName}`, startX + 5, currentY + 20);

    doc.line(startX + 105, currentY + 12, startX + 175, currentY + 12);
    doc.setFont('helvetica', 'bold');
    doc.text('END CLIENT RECEIPT CONFIRMATION', startX + 105, currentY + 16);
    doc.setFont('helvetica', 'normal');
    doc.text(`Onboarded Tenant: ${client.name}`, startX + 105, currentY + 20);
  }

  // Footer processing
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.line(startX, 282, startX + 180, 282);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(148, 163, 184);
    doc.text(`CO-BRANDED REPORT DELIVERED BY ${mspName.toUpperCase()}`, startX, 286);
    doc.text(`VERIFICATION PROTOCOL: HYBRID ATTESTATION REGISTRY | RUNTIME: ${timestamp}`, startX, 290);
    
    doc.setFont('helvetica', 'bold');
    doc.text(`Page ${i} of ${pageCount}`, startX + 163, 286);
    doc.setFont('helvetica', 'normal');
    doc.text('Software Trust Ledger', startX + 158, 290);
  }

  const clientSlug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`software-trust-report-${clientSlug}.pdf`);
}

// Generate a focused evidence report for a single software passport.
// Renders SBOM, grouped vulnerabilities, evidence ledger, and timeline.
export function generatePassportEvidenceReport(
  passport: SoftwarePassport,
  mspName: string,
  brandColorHex: string,
  logoBase64?: string
) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  const rgb = hexToRgb(brandColorHex || '#4f46e5');

  const startX = 15;
  let currentY = 15;

  // COVER HEADER
  doc.setFillColor(rgb.r, rgb.g, rgb.b);
  doc.rect(startX, currentY, 180, 36, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(`${passport.name} — Evidence Report`, startX + 6, currentY + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(`Generated: ${timestamp}`, startX + 6, currentY + 20);
  doc.text(`Compiled by: ${mspName}`, startX + 6, currentY + 26);

  if (logoBase64) {
    try {
      let format = 'PNG';
      if (logoBase64.includes('image/jpeg') || logoBase64.includes('image/jpg')) format = 'JPEG';
      else if (logoBase64.includes('image/webp')) format = 'WEBP';
      doc.addImage(logoBase64, format, startX + 140, currentY + 4, 34, 28);
    } catch (err) {
      // swallow image errors; do not block report generation
    }
  }

  currentY += 44;

  // SECTION: SBOM
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('1. SBOM Components', startX, currentY);
  doc.line(startX, currentY + 2, startX + 180, currentY + 2);
  currentY += 6;

  const sbomRows = Array.isArray(passport.sbom) && passport.sbom.length > 0
    ? (passport.sbom as any[]).map(c => [c.name || '-', c.version || '-', c.license || '-', c.dependencyType || '-', c.purl || '-'])
    : [['No components recorded for this passport', '-', '-', '-', '-']];

  autoTable(doc, {
    startY: currentY,
    head: [['Name', 'Version', 'License', 'Type', 'PURL']],
    body: sbomRows,
    theme: 'striped',
    headStyles: { fillColor: [rgb.r, rgb.g, rgb.b], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8 },
    columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 25 }, 2: { cellWidth: 30 }, 3: { cellWidth: 25 }, 4: { cellWidth: 40 } }
  });

  currentY = (doc as any).lastAutoTable.finalY + 8;

  // SECTION: Vulnerabilities (grouped by severity)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Vulnerability Findings', startX, currentY);
  doc.line(startX, currentY + 2, startX + 180, currentY + 2);
  currentY += 6;

  const vulns: Vulnerability[] = Array.isArray(passport.vulnerabilities) ? passport.vulnerabilities : [];
  if (vulns.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('No findings in current evidence.', startX, currentY);
    currentY += 8;
  } else {
    // build rows grouped by severity, but show list for readability
    const vulnRows = vulns.map(v => [v.id || '-', v.severity || '-', v.component || '-', String(v.cvss || '-'), v.title || '-']);
    autoTable(doc, {
      startY: currentY,
      head: [['CVE / ID', 'Severity', 'Component', 'CVSS', 'Title']],
      body: vulnRows,
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 25 }, 2: { cellWidth: 45 }, 3: { cellWidth: 18 }, 4: { cellWidth: 62 } }
    });
    currentY = (doc as any).lastAutoTable.finalY + 8;
  }

  // SECTION: Evidence Ledger
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('3. Evidence Ledger', startX, currentY);
  doc.line(startX, currentY + 2, startX + 180, currentY + 2);
  currentY += 6;

  const evidence: EvidenceItem[] = Array.isArray(passport.evidence) ? passport.evidence : [];
  if (evidence.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('No evidence items recorded for this passport.', startX, currentY);
    currentY += 8;
  } else {
    const evidenceRows = evidence.map(e => [e.id || '-', e.type || '-', e.status || '-', e.signer || '-', e.timestamp || '-']);
    autoTable(doc, {
      startY: currentY,
      head: [['ID', 'Type', 'Status', 'Signer', 'Timestamp']],
      body: evidenceRows,
      theme: 'striped',
      headStyles: { fillColor: [rgb.r, rgb.g, rgb.b], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 40 }, 2: { cellWidth: 28 }, 3: { cellWidth: 40 }, 4: { cellWidth: 42 } }
    });
    currentY = (doc as any).lastAutoTable.finalY + 8;
  }

  // SECTION: Timeline
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('4. Attestation Timeline', startX, currentY);
  doc.line(startX, currentY + 2, startX + 180, currentY + 2);
  currentY += 6;

  const timeline = Array.isArray(passport.timeline) ? passport.timeline : [];
  if (timeline.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('No timeline events recorded for this passport.', startX, currentY);
    currentY += 8;
  } else {
    timeline.forEach((evt) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`${evt.date} • ${evt.user} • ${evt.event}`, startX, currentY);
      currentY += 4.5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const lines = doc.splitTextToSize(evt.details || '-', 176);
      doc.text(lines, startX, currentY);
      currentY += (lines.length * 4.5) + 6;
      if (currentY > 250) {
        doc.addPage();
        currentY = 20;
      }
    });
  }

  const slug = passport.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`passport-evidence-report-${slug}.pdf`);
}
