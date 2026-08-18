/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { SoftwarePassport } from '../types';
import { 
  Maximize2, 
  Minimize2, 
  RotateCcw, 
  Activity, 
  HelpCircle,
  Fingerprint,
  Shield,
  FileCheck,
  Code,
  Layers,
  Award,
  Eye,
  TrendingUp,
  Database
} from 'lucide-react';

interface PassportD3GraphProps {
  passport: SoftwarePassport;
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  isSwarmActive: boolean;
  currentStep: number;
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: 'passport' | 'agent' | 'sbom' | 'attestation' | 'compliance' | 'threat';
  color: string;
  radius: number;
  desc?: string;
  agentId?: string;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  source: string | D3Node;
  target: string | D3Node;
  type: 'governs' | 'depends' | 'verifies' | 'proves' | 'references';
}

export default function PassportD3Graph({
  passport,
  selectedAgentId,
  onSelectAgent,
  isSwarmActive,
  currentStep
}: PassportD3GraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 420 });
  const [hoveredNode, setHoveredNode] = useState<D3Node | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Map agent index to agent ID
  const agentIdList = useMemo(() => [
    'identity-ai',
    'security-ai',
    'compliance-ai',
    'code-ai',
    'supply-chain-ai',
    'reputation-ai',
    'behavior-ai',
    'prediction-ai',
    'evidence-ai'
  ], []);

  // Set up resize observer to dynamically scale the D3 container fluidly
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // fallback to reasonable defaults if container is collapsed
        setDimensions({
          width: Math.max(width, 400),
          height: Math.max(height, 350)
        });
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Build the nodes and links array based on passport data
  const { nodes, links } = useMemo(() => {
    const nodesList: D3Node[] = [];
    const linksList: D3Link[] = [];

    // 1. Central Passport Node
    nodesList.push({
      id: 'passport-root',
      label: passport.name,
      type: 'passport',
      color: '#6366f1', // Indigo
      radius: 22,
      desc: `Ecosystem Software Asset (v${passport.version}) | SLSA Verified`
    });

    // 2. Add the 9 AI Agent Nodes
    const agentData = [
      { id: 'identity-ai', label: 'Identity AI', color: '#6366f1', desc: 'Verifies code signing, developer keys & provenance authenticity.' },
      { id: 'security-ai', label: 'Security AI', color: '#f43f5e', desc: 'Analyzes active vulnerabilities, exploit lists, and CVE trends.' },
      { id: 'compliance-ai', label: 'Compliance AI', color: '#10b981', desc: 'Collects SOC 2, ISO, and NIST alignment evidence continuous.' },
      { id: 'code-ai', label: 'Code AI', color: '#f59e0b', desc: 'Monitors cyclomatic density, test coverage, and technical debt.' },
      { id: 'supply-chain-ai', label: 'Supply Chain AI', color: '#06b6d4', desc: 'Maps dependency depth, licenses, and CycloneDX manifests.' },
      { id: 'reputation-ai', label: 'Reputation AI', color: '#3b82f6', desc: 'Tracks publisher incidents, SLAs, and continuous uptime.' },
      { id: 'behavior-ai', label: 'Behavior AI', color: '#a855f7', desc: 'Monitors sandboxed socket emissions and execution anomalies.' },
      { id: 'prediction-ai', label: 'Prediction AI', color: '#8b5cf6', desc: 'Calculates predictive failure curves and update stability indices.' },
      { id: 'evidence-ai', label: 'Evidence AI', color: '#14b8a6', desc: 'Locks cryptographically verified scan ledger entries.' }
    ];

    agentData.forEach((a) => {
      nodesList.push({
        id: a.id,
        label: a.label,
        type: 'agent',
        color: a.color,
        radius: 14,
        desc: a.desc,
        agentId: a.id
      });

      // Link agents to central Passport
      linksList.push({
        source: 'passport-root',
        target: a.id,
        type: 'governs'
      });
    });

    // 3. Add SBOM / Package Nodes (Limit to 4 for graph elegance)
    const sbomPackages = passport.sbom.slice(0, 4);
    sbomPackages.forEach((pkg, index) => {
      const nodeId = `sbom-${index}`;
      nodesList.push({
        id: nodeId,
        label: pkg.name,
        type: 'sbom',
        color: '#06b6d4', // Cyan
        radius: 9,
        desc: `Dependency Package | Version: ${pkg.version} | License: ${pkg.license || 'Permissive'}`
      });

      // Connect central passport to dependency
      linksList.push({
        source: 'passport-root',
        target: nodeId,
        type: 'depends'
      });

      // Connect Supply Chain AI agent to SBOM package
      linksList.push({
        source: 'supply-chain-ai',
        target: nodeId,
        type: 'verifies'
      });
    });

    // 4. Add Attestation Nodes (Linked to Identity AI and Evidence AI)
    const attestations = [
      { id: 'att-sig', label: 'Developer Signature Key', desc: '0x8B3fd72...49aF0c2E key attestation bound to build chain.' },
      { id: 'att-prov', label: 'SLSA Level 4 Spec', desc: 'Standardized provenance descriptor confirming binary build ledger.' }
    ];

    attestations.forEach((att) => {
      nodesList.push({
        id: att.id,
        label: att.label,
        type: 'attestation',
        color: '#818cf8', // Slate Blue
        radius: 8,
        desc: att.desc
      });

      linksList.push({
        source: 'identity-ai',
        target: att.id,
        type: 'verifies'
      });

      linksList.push({
        source: 'evidence-ai',
        target: att.id,
        type: 'proves'
      });
    });

    // 5. Add Compliance Evidence Nodes (Linked to Compliance AI)
    const complianceEvidences = [
      { id: 'comp-soc2', label: 'SOC 2 Audit Proof', desc: 'Dynamically generated control evidence logs recorded.' },
      { id: 'comp-nist', label: 'NIST 800-218 Matrix', desc: 'Secure software design lifecycle control parameters.' }
    ];

    complianceEvidences.forEach((ev) => {
      nodesList.push({
        id: ev.id,
        label: ev.label,
        type: 'compliance',
        color: '#34d399', // Emerald
        radius: 8,
        desc: ev.desc
      });

      linksList.push({
        source: 'compliance-ai',
        target: ev.id,
        type: 'proves'
      });
    });

    // 6. Add Security Threat / CVE Nodes (Linked to Security AI)
    if (passport.vulnerabilities.length > 0) {
      passport.vulnerabilities.slice(0, 2).forEach((v) => {
        const nodeId = `threat-${v.id}`;
        nodesList.push({
          id: nodeId,
          label: v.id,
          type: 'threat',
          color: '#f43f5e', // Rose
          radius: 9,
          desc: `CVE vulnerability alert | CVSS: ${v.cvss} | Status: ${v.status}`
        });

        linksList.push({
          source: 'security-ai',
          target: nodeId,
          type: 'references'
        });
      });
    } else {
      // Add a 'Clean Scan' node to verify security integrity
      nodesList.push({
        id: 'threat-clean',
        label: 'Zero Open Exploits',
        type: 'threat',
        color: '#34d399', // Emerald green
        radius: 8,
        desc: 'Continuous vulnerability scan checked against updated CVE listings.'
      });

      linksList.push({
        source: 'security-ai',
        target: 'threat-clean',
        type: 'references'
      });
    }

    return { nodes: nodesList, links: linksList };
  }, [passport, agentIdList]);

  // Main D3 force layout rendering loop
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove(); // Clear previous nodes

    const width = dimensions.width;
    const height = dimensions.height;

    // Create a zoom container grouping all nodes
    const g = svg.append('g').attr('class', 'graph-container');

    // Add D3 Zoom support
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoomBehavior);

    // Initial positioning setup
    nodes.forEach((n) => {
      if (n.id === 'passport-root') {
        n.fx = width / 2;
        n.fy = height / 2;
      }
    });

    // Configure the force simulation
    const simulation = d3.forceSimulation<D3Node>(nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(links)
        .id((d) => d.id)
        .distance((d: any) => {
          if (d.type === 'governs') return 110;
          return 65;
        })
      )
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d: any) => d.radius + 18));

    // Render the Link connections
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', (d: any) => {
        if (d.type === 'governs') return '#e2e8f0'; // slate-200 / light gray
        if (d.type === 'depends') return '#cbd5e1'; 
        return '#f1f5f9';
      })
      .attr('stroke-opacity', 0.8)
      .attr('stroke-width', (d: any) => {
        if (d.type === 'governs') return 1.8;
        return 1.2;
      })
      .attr('stroke-dasharray', (d: any) => {
        // Dash pattern for attestations & compliance indicators
        if (d.type === 'proves' || d.type === 'verifies') return '4,4';
        return 'none';
      });

    // Define Node groups
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('.node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .on('click', (event, d: any) => {
        if (d.type === 'agent' && d.agentId) {
          onSelectAgent(d.agentId);
        }
      })
      .on('mouseover', (event, d: any) => {
        setHoveredNode(d);
        // Compute SVG bounding rect to anchor tooltip beautifully
        const [mx, my] = d3.pointer(event, svgRef.current);
        setTooltipPos({ x: mx + 15, y: my + 15 });
      })
      .on('mousemove', (event) => {
        const [mx, my] = d3.pointer(event, svgRef.current);
        setTooltipPos({ x: mx + 15, y: my + 15 });
      })
      .on('mouseout', () => {
        setHoveredNode(null);
      })
      .call(drag(simulation) as any);

    // Add glowing halo effect behind central asset and active nodes
    const halo = node.append('circle')
      .attr('r', (d: any) => d.radius + 6)
      .attr('fill', 'none')
      .attr('stroke', (d: any) => d.color)
      .attr('stroke-opacity', (d: any) => (d.id === 'passport-root' ? 0.3 : 0))
      .attr('stroke-width', 2)
      .attr('class', 'node-halo');

    // Draw the actual solid circles
    const circle = node.append('circle')
      .attr('r', (d: any) => d.radius)
      .attr('fill', (d: any) => d.color)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2)
      .attr('shadow', '0 4px 6px -1px rgb(0 0 0 / 0.1)')
      .attr('class', 'node-circle');

    // Append labels above nodes
    const label = node.append('text')
      .attr('dy', (d: any) => d.radius + 15)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-family', '"JetBrains Mono", monospace')
      .attr('font-weight', (d: any) => (d.type === 'passport' || d.type === 'agent' ? 'bold' : 'normal'))
      .attr('fill', '#334155') // slate-700
      .text((d: any) => d.label);

    // Update coordinates in real-time on simulation ticks
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x}, ${d.y})`);
    });

    // Drag-handler helper functions
    function drag(sim: d3.Simulation<D3Node, undefined>) {
      function dragstarted(event: any, d: any) {
        if (!event.active) sim.alphaTarget(0.2).restart();
        d.fx = d.x;
        d.fy = d.y;
      }

      function dragged(event: any, d: any) {
        d.fx = event.x;
        d.fy = event.y;
      }

      function dragended(event: any, d: any) {
        if (!event.active) sim.alphaTarget(0);
        // Only let users drag non-central nodes indefinitely
        if (d.id !== 'passport-root') {
          d.fx = null;
          d.fy = null;
        }
      }

      return d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended);
    }

    // Capture standard fit trigger to auto-center view once on initial load
    const fitTimer = setTimeout(() => {
      const scale = 0.85;
      const tx = width / 2 - (width / 2) * scale;
      const ty = height / 2 - (height / 2) * scale;
      svg.transition().duration(500).call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
    }, 100);

    return () => {
      simulation.stop();
      clearTimeout(fitTimer);
    };
  }, [nodes, links, dimensions]);

  // Update selection halos and line glowing when selectedAgentId or isSwarmActive updates
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    
    // 1. Highlight selected agent node
    svg.selectAll('.node-circle')
      .transition()
      .duration(300)
      .attr('stroke', (d: any) => {
        if (d.id === selectedAgentId) return '#4f46e5'; // active indigo border
        return '#ffffff';
      })
      .attr('stroke-width', (d: any) => {
        if (d.id === selectedAgentId) return 3;
        return 2;
      });

    // 2. Animate pulsating halos for active agents
    svg.selectAll('.node-halo')
      .transition()
      .duration(300)
      .attr('stroke-opacity', (d: any) => {
        if (d.id === 'passport-root') return 0.25;
        if (d.id === selectedAgentId) return 0.5;
        return 0;
      })
      .attr('r', (d: any) => {
        if (d.id === selectedAgentId) return d.radius + 8;
        return d.radius + 5;
      });

    // 3. Highlight/Pulse the active scanner agent node during Swarm scanning
    if (isSwarmActive && currentStep !== -1) {
      const activeStepAgentId = agentIdList[currentStep];
      svg.selectAll('.node-circle')
        .filter((d: any) => d.id === activeStepAgentId)
        .attr('stroke', '#f59e0b') // glowing amber during active audit
        .attr('stroke-width', 4.5);

      svg.selectAll('.node-halo')
        .filter((d: any) => d.id === activeStepAgentId)
        .attr('stroke', '#f59e0b')
        .attr('stroke-opacity', 0.8)
        .attr('r', (d: any) => d.radius + 12);

      // Animate active scanner connections
      svg.selectAll('.links line')
        .transition()
        .duration(200)
        .attr('stroke', (d: any) => {
          const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
          const targetId = typeof d.target === 'object' ? d.target.id : d.target;
          if (sourceId === activeStepAgentId || targetId === activeStepAgentId) {
            return '#f59e0b'; // Amber for active audit scanning channels
          }
          return '#e2e8f0';
        })
        .attr('stroke-width', (d: any) => {
          const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
          const targetId = typeof d.target === 'object' ? d.target.id : d.target;
          if (sourceId === activeStepAgentId || targetId === activeStepAgentId) {
            return 3;
          }
          return 1.2;
        });
    } else {
      // Restore standard slate connections when idle
      svg.selectAll('.links line')
        .transition()
        .duration(300)
        .attr('stroke', '#e2e8f0')
        .attr('stroke-width', 1.2);
    }

  }, [selectedAgentId, isSwarmActive, currentStep, agentIdList]);

  // Center or reset simulation
  const handleResetZoom = () => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const scale = 0.9;
    const tx = dimensions.width / 2 - (dimensions.width / 2) * scale;
    const ty = dimensions.height / 2 - (dimensions.height / 2) * scale;
    
    svg.transition().duration(600).call(
      d3.zoom().transform as any,
      d3.zoomIdentity.translate(tx, ty).scale(scale)
    );
  };

  return (
    <div className="bg-slate-50 dark:bg-zinc-950/40 border border-slate-150 dark:border-zinc-850 rounded-2xl p-4.5 relative" id="swarm-d3-visualization-box">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-1.8 text-xs text-slate-500 font-mono">
          <Activity className={`w-3.5 h-3.5 ${isSwarmActive ? 'text-indigo-500 animate-pulse' : 'text-slate-400'}`} />
          <span>Interactive Cognitive Relation Ledger</span>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetZoom}
            className="p-1.5 hover:bg-white dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-850 rounded-lg text-slate-500 dark:text-zinc-400 transition-colors cursor-pointer text-[10px] font-bold flex items-center gap-1"
            title="Recenter and Fit View"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Recenter Graph</span>
          </button>
        </div>
      </div>

      <div 
        ref={containerRef} 
        className="w-full h-[400px] border border-slate-200/60 dark:border-zinc-850/60 rounded-xl overflow-hidden bg-white dark:bg-zinc-950 relative shadow-inner"
      >
        <svg 
          ref={svgRef} 
          width="100%" 
          height="100%" 
          className="block"
        />

        {/* Hover absolute tooltip inside the absolute SVG bounds */}
        {hoveredNode && (
          <div 
            className="absolute z-30 bg-slate-900/95 dark:bg-zinc-900/95 border border-slate-800 backdrop-blur-md text-white p-3.5 rounded-xl shadow-xl max-w-xs pointer-events-none text-left animate-in fade-in zoom-in-95 duration-100"
            style={{ 
              left: `${tooltipPos.x}px`, 
              top: `${tooltipPos.y}px`,
              transform: 'translate(0, 0)'
            }}
          >
            <div className="flex items-center gap-2">
              <span 
                className="w-2.5 h-2.5 rounded-full" 
                style={{ backgroundColor: hoveredNode.color }}
              />
              <h5 className="text-[11px] font-bold font-mono uppercase tracking-wide text-slate-100 leading-none">
                {hoveredNode.label}
              </h5>
            </div>
            <p className="text-[10px] text-slate-300 font-sans mt-2 leading-relaxed">
              {hoveredNode.desc}
            </p>
            {hoveredNode.type === 'agent' && (
              <div className="mt-2.5 pt-2 border-t border-slate-800 text-[9px] text-indigo-300 font-mono font-semibold flex items-center gap-1">
                <span>⚡ Click node to load agent console telemetry</span>
              </div>
            )}
          </div>
        )}

        {/* Grid Overlay Guide Watermark */}
        <div className="absolute right-3.5 bottom-3 text-[9px] font-mono text-slate-400/80 pointer-events-none select-none uppercase tracking-widest flex items-center gap-1.5 bg-slate-50/50 dark:bg-zinc-900/40 px-2 py-1 rounded-md border border-slate-100 dark:border-zinc-800/30">
          <span>D3-FORCE GRAPH engine active</span>
        </div>
      </div>

      {/* Mini Node Color/Icon Legend Bar */}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-3 pt-3 border-t border-slate-150 dark:border-zinc-850 text-[10px] text-slate-500 font-mono">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
          <span>Central Passport Asset</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#f43f5e]"></span>
          <span>Threat Monitor / CVE</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]"></span>
          <span>AI Agents Swarm</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#06b6d4]"></span>
          <span>Dependencies (SBOM)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#818cf8]"></span>
          <span>Attestation Stamps</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#34d399]"></span>
          <span>Compliance Proofs</span>
        </span>
      </div>
    </div>
  );
}
