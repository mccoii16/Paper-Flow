import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardList,
  GitBranch,
  Link2,
  MessageSquare,
  Play,
  Plus,
  Save,
  Trash2,
  UserCheck,
  UserPlus,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type {
  LeadStatus,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
} from '../../types/paperflow';
import { simulateWorkflowRun, type WorkflowSimulationTrace } from '../../utils/automationEngine';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 112;

const NODE_CATALOG: Array<{
  type: WorkflowNodeType;
  label: string;
  accentText: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultTitle: string;
}> = [
  {
    type: 'trigger',
    label: 'Trigger',
    accentText: 'text-pink-700 dark:text-pink-300',
    icon: Zap,
    defaultTitle: 'Messenger Trigger',
  },
  {
    type: 'condition',
    label: 'Condition',
    accentText: 'text-indigo-700 dark:text-indigo-300',
    icon: GitBranch,
    defaultTitle: 'Check Condition',
  },
  {
    type: 'send_reply',
    label: 'Send Reply',
    accentText: 'text-sky-700 dark:text-sky-300',
    icon: MessageSquare,
    defaultTitle: 'Send Reply',
  },
  {
    type: 'collect_info',
    label: 'Collect Info',
    accentText: 'text-violet-700 dark:text-violet-300',
    icon: ClipboardList,
    defaultTitle: 'Collect Information',
  },
  {
    type: 'update_lead',
    label: 'Update Lead',
    accentText: 'text-emerald-700 dark:text-emerald-400',
    icon: UserPlus,
    defaultTitle: 'Update Lead Status',
  },
  {
    type: 'human_handoff',
    label: 'Human Handoff',
    accentText: 'text-amber-700 dark:text-amber-400',
    icon: UserCheck,
    defaultTitle: 'Human Handoff',
  },
];

function getNodeMeta(type: WorkflowNodeType) {
  return NODE_CATALOG.find((c) => c.type === type) ?? NODE_CATALOG[0];
}

function summarizeNode(node: WorkflowNode): string {
  switch (node.type) {
    case 'trigger':
      return node.config.keywords?.length
        ? `Keywords: ${node.config.keywords.slice(0, 3).join(', ')}`
        : 'On incoming message';
    case 'condition':
      return `If ${node.config.conditionField ?? 'message_text'} ${node.config.conditionOperator ?? 'contains'} "${node.config.conditionValue ?? ''}"`;
    case 'send_reply':
      return node.config.replyText || 'Configure reply template...';
    case 'collect_info':
      return `Ask for ${node.config.targetField ?? 'event_date'}`;
    case 'update_lead':
      return `Set ${node.config.newLeadStatus ?? 'Qualified'}`;
    case 'human_handoff':
      return `Assign: ${node.config.handoffTeam ?? 'Studio Coordinator'}`;
  }
}

export function WorkflowBuilderPage() {
  const { workspace, selectedWorkflowId, setSelectedWorkflowId, saveWorkflow, theme } = useApp();

  const sourceWorkflow = useMemo(
    () =>
      workspace.workflows.find((w) => w.id === selectedWorkflowId) ?? workspace.workflows[0],
    [workspace.workflows, selectedWorkflowId]
  );

  const [draft, setDraft] = useState<Workflow | null>(() =>
    sourceWorkflow ? structuredClone(sourceWorkflow) : null
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    sourceWorkflow?.nodes[0]?.id ?? null
  );
  const [zoom, setZoom] = useState<number>(1);
  const [connectFrom, setConnectFrom] = useState<{
    nodeId: string;
    branch: WorkflowEdge['branch'];
  } | null>(null);

  const [simMessage, setSimMessage] = useState('Hi! Asking for wedding mirror booth rates');
  const [simTrace, setSimTrace] = useState<WorkflowSimulationTrace | null>(null);
  const [rightTab, setRightTab] = useState<'inspector' | 'test'>('inspector');

  const dragState = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    if (sourceWorkflow) {
      setDraft(structuredClone(sourceWorkflow));
      setSelectedNodeId(sourceWorkflow.nodes[0]?.id ?? null);
      setSimTrace(null);
      setConnectFrom(null);
    }
  }, [sourceWorkflow]);

  if (!draft) {
    return (
      <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-10 text-center text-sm text-slate-500">
        No workflows available. Create one in Automations first.
      </div>
    );
  }

  const selectedNode = draft.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const handleAddNode = (type: WorkflowNodeType) => {
    const meta = getNodeMeta(type);
    const maxRight = draft.nodes.reduce((max, n) => Math.max(max, n.x), 40);
    const newNode: WorkflowNode = {
      id: `node-${Date.now().toString(36)}`,
      type,
      title: meta.defaultTitle,
      x: Math.min(maxRight + 260, 1280),
      y: 160 + ((draft.nodes.length % 3) - 1) * 90,
      config:
        type === 'trigger'
          ? { triggerEvent: 'keyword_match', keywords: ['inquiry'] }
          : type === 'condition'
          ? { conditionField: 'message_text', conditionOperator: 'contains', conditionValue: 'wedding' }
          : type === 'send_reply'
          ? { replyText: 'Hi {{first_name}}! Here are our Paper Dreams Cebu package details.', useKnowledgeBase: true }
          : type === 'collect_info'
          ? { promptText: 'What is your event date and Cebu venue?', targetField: 'event_date' }
          : type === 'update_lead'
          ? { newLeadStatus: 'Qualified', addTags: ['Automated'] }
          : { handoffTeam: 'Clarisse Mendoza', handoffNote: 'Operator follow-up needed', pauseAi: true },
    };

    const nextEdges = [...draft.edges];
    if (selectedNodeId && type !== 'trigger') {
      nextEdges.push({
        id: `edge-${Date.now()}`,
        source: selectedNodeId,
        target: newNode.id,
        branch: 'default',
      });
    }

    setDraft({
      ...draft,
      nodes: [...draft.nodes, newNode],
      edges: nextEdges,
    });
    setSelectedNodeId(newNode.id);
    setRightTab('inspector');
  };

  const handleUpdateNode = (nodeId: string, updater: (n: WorkflowNode) => WorkflowNode) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            nodes: prev.nodes.map((n) => (n.id === nodeId ? updater(n) : n)),
          }
        : prev
    );
  };

  const handleDeleteNode = (nodeId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const remaining = prev.nodes.filter((n) => n.id !== nodeId);
      return {
        ...prev,
        nodes: remaining,
        edges: prev.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      };
    });
    setSelectedNodeId(null);
  };

  const handleDeleteEdge = (edgeId: string) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            edges: prev.edges.filter((e) => e.id !== edgeId),
          }
        : prev
    );
  };

  const handleCompleteConnection = (targetNodeId: string) => {
    if (!connectFrom || connectFrom.nodeId === targetNodeId) {
      setConnectFrom(null);
      return;
    }
    const alreadyExists = draft.edges.some(
      (e) =>
        e.source === connectFrom.nodeId &&
        e.target === targetNodeId &&
        e.branch === connectFrom.branch
    );
    if (!alreadyExists) {
      const label =
        connectFrom.branch === 'true'
          ? 'True'
          : connectFrom.branch === 'false'
          ? 'False'
          : undefined;
      setDraft({
        ...draft,
        edges: [
          ...draft.edges,
          {
            id: `edge-${Date.now()}`,
            source: connectFrom.nodeId,
            target: targetNodeId,
            branch: connectFrom.branch,
            label,
          },
        ],
      });
    }
    setConnectFrom(null);
  };

  const handlePointerDownNode = (e: React.PointerEvent, node: WorkflowNode) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (connectFrom) {
      handleCompleteConnection(node.id);
      return;
    }
    setSelectedNodeId(node.id);
    dragState.current = {
      nodeId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: node.x,
      origY: node.y,
    };
  };

  const handlePointerMoveCanvas = (e: React.PointerEvent) => {
    if (!dragState.current) return;
    const { nodeId, startX, startY, origX, origY } = dragState.current;
    const dx = (e.clientX - startX) / zoom;
    const dy = (e.clientY - startY) / zoom;
    const nextX = Math.max(20, Math.round(origX + dx));
    const nextY = Math.max(20, Math.round(origY + dy));
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            nodes: prev.nodes.map((n) =>
              n.id === nodeId ? { ...n, x: nextX, y: nextY } : n
            ),
          }
        : prev
    );
  };

  const handlePointerUpCanvas = () => {
    dragState.current = null;
  };

  const handleRunTest = (e: React.FormEvent) => {
    e.preventDefault();
    const trace = simulateWorkflowRun(draft, {
      guestName: 'Ysabel Villanueva',
      messageText: simMessage,
      leadStatus: 'New Inquiry',
      tags: [],
    });
    setSimTrace(trace);
  };

  const tracedNodeIds = new Set(simTrace?.steps.map((s) => s.nodeId) ?? []);

  return (
    <div className="space-y-4">
      {/* Builder Top Toolbar */}
      <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-3.5 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <label htmlFor="builder-wf-select" className="sr-only">
            Select workflow
          </label>
          <select
            id="builder-wf-select"
            value={draft.id}
            onChange={(e) => setSelectedWorkflowId(e.target.value)}
            className="rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-pink-500/40"
          >
            {workspace.workflows.map((wf) => (
              <option key={wf.id} value={wf.id}>
                {wf.name} ({wf.status})
              </option>
            ))}
          </select>

          <div className="flex flex-wrap items-center gap-1.5">
            {NODE_CATALOG.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => handleAddNode(item.type)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-white dark:bg-[#0B1120] hover:border-pink-400 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
                >
                  <Plus className="h-3 w-3 text-pink-600 dark:text-pink-400" aria-hidden="true" />
                  <Icon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex items-center rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120]">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.65, Number((z - 0.1).toFixed(2))))}
              aria-label="Zoom out canvas"
              className="p-2 text-slate-600 dark:text-slate-300 hover:text-[#0F172A] dark:hover:text-white"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.3, Number((z + 0.1).toFixed(2))))}
              aria-label="Zoom in canvas"
              className="p-2 text-slate-600 dark:text-slate-300 hover:text-[#0F172A] dark:hover:text-white"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setRightTab((t) => (t === 'test' ? 'inspector' : 'test'))}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap ${
              rightTab === 'test'
                ? 'border-pink-500 bg-pink-50 text-pink-800 dark:bg-pink-950/40 dark:text-pink-200'
                : 'border-[#E7E4ED] dark:border-slate-700 text-slate-700 dark:text-slate-200'
            }`}
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Test Flow</span>
          </button>

          <button
            type="button"
            onClick={() => saveWorkflow(draft)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] dark:bg-pink-600 dark:hover:bg-pink-500 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Save Workflow</span>
          </button>
        </div>
      </div>

      {connectFrom && (
        <div className="rounded-xl border border-pink-300 dark:border-pink-800 bg-pink-50 dark:bg-pink-950/30 px-4 py-2 text-xs font-medium text-pink-900 dark:text-pink-100 flex items-center justify-between">
          <span>
            Connect mode active: click any target node card to link edge ({connectFrom.branch} branch).
          </span>
          <button
            type="button"
            onClick={() => setConnectFrom(null)}
            className="underline font-semibold"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Canvas + Right Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Visual Canvas */}
        <div
          data-testid="workflow-canvas"
          onPointerMove={handlePointerMoveCanvas}
          onPointerUp={handlePointerUpCanvas}
          onPointerLeave={handlePointerUpCanvas}
          className={`lg:col-span-8 xl:col-span-9 rounded-2xl border border-[#E7E4ED] dark:border-slate-800 overflow-auto relative min-h-[540px] select-none ${
            theme === 'dark' ? 'workflow-grid-dark' : 'workflow-grid-light'
          }`}
        >
          <div
            className="relative"
            style={{
              width: '1600px',
              height: '620px',
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          >
            {/* SVG Edges Layer */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="arrow-head"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill={theme === 'dark' ? '#f472b6' : '#0f172a'} />
                </marker>
              </defs>

              {draft.edges.map((edge) => {
                const src = draft.nodes.find((n) => n.id === edge.source);
                const tgt = draft.nodes.find((n) => n.id === edge.target);
                if (!src || !tgt) return null;

                const startX = src.x + NODE_WIDTH;
                const startY =
                  edge.branch === 'true'
                    ? src.y + NODE_HEIGHT * 0.35
                    : edge.branch === 'false'
                    ? src.y + NODE_HEIGHT * 0.72
                    : src.y + NODE_HEIGHT / 2;

                const endX = tgt.x;
                const endY = tgt.y + NODE_HEIGHT / 2;
                const dx = Math.max(60, Math.abs(endX - startX) * 0.5);
                const pathD = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;

                const strokeColor =
                  edge.branch === 'true'
                    ? '#16a34a'
                    : edge.branch === 'false'
                    ? '#d97706'
                    : theme === 'dark'
                    ? '#f472b6'
                    : '#0f172a';

                const midX = (startX + endX) / 2;
                const midY = (startY + endY) / 2;

                return (
                  <g key={edge.id}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth="2"
                      strokeOpacity="0.7"
                      markerEnd="url(#arrow-head)"
                    />
                    {edge.label && (
                      <text
                        x={midX}
                        y={midY - 12}
                        textAnchor="middle"
                        className="text-[11px] font-semibold fill-slate-700 dark:fill-slate-200"
                      >
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Edge remove clickable buttons */}
            {draft.edges.map((edge) => {
              const src = draft.nodes.find((n) => n.id === edge.source);
              const tgt = draft.nodes.find((n) => n.id === edge.target);
              if (!src || !tgt) return null;
              const startX = src.x + NODE_WIDTH;
              const startY =
                edge.branch === 'true'
                  ? src.y + NODE_HEIGHT * 0.35
                  : edge.branch === 'false'
                  ? src.y + NODE_HEIGHT * 0.72
                  : src.y + NODE_HEIGHT / 2;
              const endX = tgt.x;
              const endY = tgt.y + NODE_HEIGHT / 2;
              const posX = startX + (endX - startX) * 0.32;
              const posY = startY + (endY - startY) * 0.32;
              return (
                <button
                  key={`rm-${edge.id}`}
                  type="button"
                  onClick={() => handleDeleteEdge(edge.id)}
                  title="Remove connection"
                  aria-label={`Disconnect ${src.title} from ${tgt.title}`}
                  style={{
                    left: `${posX - 9}px`,
                    top: `${posY + 8}px`,
                  }}
                  className="absolute h-[18px] w-[18px] rounded-full bg-white dark:bg-slate-800 border border-[#E7E4ED] dark:border-slate-700 text-[10px] font-bold text-slate-500 hover:text-rose-600 flex items-center justify-center shadow-xs"
                >
                  ×
                </button>
              );
            })}

            {/* Nodes */}
            {draft.nodes.map((node) => {
              const meta = getNodeMeta(node.type);
              const Icon = meta.icon;
              const isSelected = selectedNodeId === node.id;
              const isHighlighted = tracedNodeIds.has(node.id);

              return (
                <div
                  key={node.id}
                  onPointerDown={(e) => handlePointerDownNode(e, node)}
                  style={{
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${NODE_WIDTH}px`,
                    minHeight: `${NODE_HEIGHT}px`,
                  }}
                  className={`absolute rounded-2xl border bg-white dark:bg-[#131C31] p-3.5 cursor-grab active:cursor-grabbing transition-shadow ${
                    isHighlighted
                      ? 'border-emerald-500 ring-2 ring-emerald-500/30'
                      : isSelected
                      ? 'border-pink-500 ring-2 ring-pink-500/25'
                      : 'border-[#DDD8E6] dark:border-slate-700 hover:border-pink-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${meta.accentText}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{meta.label}</span>
                    </span>

                    <div className="flex items-center gap-1">
                      {node.type === 'condition' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setConnectFrom({ nodeId: node.id, branch: 'true' })}
                            title="Connect True branch"
                            className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
                          >
                            True
                          </button>
                          <button
                            type="button"
                            onClick={() => setConnectFrom({ nodeId: node.id, branch: 'false' })}
                            title="Connect False branch"
                            className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                          >
                            False
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConnectFrom({ nodeId: node.id, branch: 'default' })}
                          title="Connect to another node"
                          aria-label={`Connect from ${node.title}`}
                          className="p-1 rounded-lg text-slate-400 hover:text-pink-600 dark:hover:text-pink-300"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedNodeId(node.id)}
                    className="mt-1.5 text-left w-full"
                  >
                    <div className="font-display text-sm font-bold text-[#0F172A] dark:text-white truncate">
                      {node.title}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                      {summarizeNode(node)}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Panel: Node Inspector or Test Simulator */}
        <aside className="lg:col-span-4 xl:col-span-3 rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5 flex flex-col gap-4">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F4F1F6] dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setRightTab('inspector')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                rightTab === 'inspector'
                  ? 'bg-white dark:bg-[#131C31] text-[#0F172A] dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Inspector
            </button>
            <button
              type="button"
              onClick={() => setRightTab('test')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                rightTab === 'test'
                  ? 'bg-white dark:bg-[#131C31] text-[#0F172A] dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Simulator
            </button>
          </div>

          {rightTab === 'inspector' ? (
            selectedNode ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-pink-700 dark:text-pink-300">
                    {getNodeMeta(selectedNode.type).label} Node
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteNode(selectedNode.id)}
                    aria-label={`Delete node ${selectedNode.title}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                </div>

                <div>
                  <label htmlFor="node-title" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Node Title
                  </label>
                  <input
                    id="node-title"
                    type="text"
                    value={selectedNode.title}
                    onChange={(e) =>
                      handleUpdateNode(selectedNode.id, (n) => ({ ...n, title: e.target.value }))
                    }
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                  />
                </div>

                {selectedNode.type === 'trigger' && (
                  <>
                    <div>
                      <label htmlFor="trig-event" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Trigger Type
                      </label>
                      <select
                        id="trig-event"
                        value={selectedNode.config.triggerEvent ?? 'keyword_match'}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.id, (n) => ({
                            ...n,
                            config: {
                              ...n.config,
                              triggerEvent: e.target.value as WorkflowNode['config']['triggerEvent'],
                            },
                          }))
                        }
                        className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs"
                      >
                        <option value="keyword_match">Messenger Keyword Match</option>
                        <option value="message_received">Any First Message</option>
                        <option value="postback_click">Postback Button</option>
                        <option value="story_reply">Story Reply</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="trig-kw" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Keywords (comma separated)
                      </label>
                      <input
                        id="trig-kw"
                        type="text"
                        value={(selectedNode.config.keywords ?? []).join(', ')}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.id, (n) => ({
                            ...n,
                            config: {
                              ...n.config,
                              keywords: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            },
                          }))
                        }
                        className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs"
                      />
                    </div>
                  </>
                )}

                {selectedNode.type === 'condition' && (
                  <>
                    <div>
                      <label htmlFor="cond-field" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Evaluate Field
                      </label>
                      <select
                        id="cond-field"
                        value={selectedNode.config.conditionField ?? 'message_text'}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.id, (n) => ({
                            ...n,
                            config: {
                              ...n.config,
                              conditionField: e.target.value as WorkflowNode['config']['conditionField'],
                            },
                          }))
                        }
                        className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs"
                      >
                        <option value="message_text">Message Text</option>
                        <option value="lead_status">Lead Status</option>
                        <option value="tag">Contact Tag</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="cond-val" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Match Value
                      </label>
                      <input
                        id="cond-val"
                        type="text"
                        value={selectedNode.config.conditionValue ?? ''}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.id, (n) => ({
                            ...n,
                            config: { ...n.config, conditionValue: e.target.value },
                          }))
                        }
                        className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs"
                      />
                    </div>
                  </>
                )}

                {selectedNode.type === 'send_reply' && (
                  <div>
                    <label htmlFor="reply-tpl" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Reply Template (supports {'{{first_name}}'})
                    </label>
                    <textarea
                      id="reply-tpl"
                      rows={4}
                      value={selectedNode.config.replyText ?? ''}
                      onChange={(e) =>
                        handleUpdateNode(selectedNode.id, (n) => ({
                          ...n,
                          config: { ...n.config, replyText: e.target.value },
                        }))
                      }
                      className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs"
                    />
                  </div>
                )}

                {selectedNode.type === 'collect_info' && (
                  <>
                    <div>
                      <label htmlFor="collect-field" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Target Lead Field
                      </label>
                      <select
                        id="collect-field"
                        value={selectedNode.config.targetField ?? 'event_date'}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.id, (n) => ({
                            ...n,
                            config: {
                              ...n.config,
                              targetField: e.target.value as WorkflowNode['config']['targetField'],
                            },
                          }))
                        }
                        className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs"
                      >
                        <option value="event_date">Event Date</option>
                        <option value="venue">Venue</option>
                        <option value="guest_count">Guest Count</option>
                        <option value="package_interest">Package Interest</option>
                        <option value="email">Email</option>
                        <option value="phone">Phone Number</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="collect-prompt" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Question Prompt
                      </label>
                      <textarea
                        id="collect-prompt"
                        rows={3}
                        value={selectedNode.config.promptText ?? ''}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.id, (n) => ({
                            ...n,
                            config: { ...n.config, promptText: e.target.value },
                          }))
                        }
                        className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs"
                      />
                    </div>
                  </>
                )}

                {selectedNode.type === 'update_lead' && (
                  <>
                    <div>
                      <label htmlFor="upd-status" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Set Lead Status
                      </label>
                      <select
                        id="upd-status"
                        value={selectedNode.config.newLeadStatus ?? 'Qualified'}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.id, (n) => ({
                            ...n,
                            config: { ...n.config, newLeadStatus: e.target.value as LeadStatus },
                          }))
                        }
                        className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs"
                      >
                        <option value="New Inquiry">New Inquiry</option>
                        <option value="Qualified">Qualified</option>
                        <option value="Proposal Sent">Proposal Sent</option>
                        <option value="Booked">Booked</option>
                        <option value="Needs Handoff">Needs Handoff</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="upd-tags" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Apply Tags (comma separated)
                      </label>
                      <input
                        id="upd-tags"
                        type="text"
                        value={(selectedNode.config.addTags ?? []).join(', ')}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.id, (n) => ({
                            ...n,
                            config: {
                              ...n.config,
                              addTags: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            },
                          }))
                        }
                        className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs"
                      />
                    </div>
                  </>
                )}

                {selectedNode.type === 'human_handoff' && (
                  <>
                    <div>
                      <label htmlFor="handoff-team" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Assign Operator / Team
                      </label>
                      <input
                        id="handoff-team"
                        type="text"
                        value={selectedNode.config.handoffTeam ?? ''}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.id, (n) => ({
                            ...n,
                            config: { ...n.config, handoffTeam: e.target.value },
                          }))
                        }
                        className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="handoff-note" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Internal Handoff Note
                      </label>
                      <textarea
                        id="handoff-note"
                        rows={3}
                        value={selectedNode.config.handoffNote ?? ''}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.id, (n) => ({
                            ...n,
                            config: { ...n.config, handoffNote: e.target.value },
                          }))
                        }
                        className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs"
                      />
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Click any node on the canvas to inspect or edit its configuration. Drag cards to reposition them.
              </p>
            )
          ) : (
            <form onSubmit={handleRunTest} className="space-y-4">
              <div>
                <label htmlFor="sim-msg-input" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Test Guest Message
                </label>
                <textarea
                  id="sim-msg-input"
                  rows={3}
                  value={simMessage}
                  onChange={(e) => setSimMessage(e.target.value)}
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Run Simulation</span>
              </button>

              {simTrace && (
                <div className="pt-3 border-t border-[#E7E4ED] dark:border-slate-800 space-y-2.5 text-xs">
                  <div className="font-semibold text-[#0F172A] dark:text-white">
                    {simTrace.matchedTrigger
                      ? `Executed ${simTrace.steps.length} steps`
                      : 'Trigger did not match'}
                  </div>
                  <ol className="space-y-2">
                    {simTrace.steps.map((step, i) => (
                      <li
                        key={`${step.nodeId}-${i}`}
                        className="rounded-xl border border-[#E7E4ED] dark:border-slate-800 bg-[#FAF8FB] dark:bg-[#0B1120] p-2.5"
                      >
                        <div className="font-semibold text-[#0F172A] dark:text-slate-100">
                          {i + 1}. {step.title}
                        </div>
                        <div className="text-slate-600 dark:text-slate-300 mt-0.5">
                          {step.outcome}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
