'use client';

/**
 * ReactFlow canvas for visualizing routes.
 * Channel nodes → Route nodes → Recipient nodes
 *
 * This file is dynamically imported (no SSR) from the routes page.
 */

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Tag, Tooltip } from 'antd';
import { useCallback, useEffect } from 'react';
import type { Channel, Recipient, Route } from '@/lib/api-client';

// ─── Node data types ──────────────────────────────────────────────────────────

interface ChannelNodeData extends Record<string, unknown> {
  channel: Channel;
}

interface RecipientNodeData extends Record<string, unknown> {
  recipient: Recipient;
}

interface RouteNodeData extends Record<string, unknown> {
  route: Route;
  highlighted: boolean;
  onEdit: (route: Route) => void;
}

// ─── Custom node components ───────────────────────────────────────────────────

function ChannelNode({ data }: NodeProps) {
  const { channel } = data as ChannelNodeData;
  return (
    <div
      style={{
        background: '#e6f4ff',
        border: '2px solid #1677ff',
        borderRadius: 8,
        padding: '10px 16px',
        minWidth: 140,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>CHANNEL</div>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{channel.id}</div>
      <Tag color="blue" style={{ marginTop: 4, fontSize: 11 }}>
        {channel.platform}
      </Tag>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function RecipientNode({ data }: NodeProps) {
  const { recipient } = data as RecipientNodeData;
  const shortUrl = recipient.webhookUrl.replace(/^https?:\/\//, '').slice(0, 28);
  return (
    <div
      style={{
        background: '#f6ffed',
        border: '2px solid #52c41a',
        borderRadius: 8,
        padding: '10px 16px',
        minWidth: 140,
        textAlign: 'center',
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>RECIPIENT</div>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{recipient.id}</div>
      <Tooltip title={recipient.webhookUrl}>
        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{shortUrl}…</div>
      </Tooltip>
    </div>
  );
}

function RouteNode({ data }: NodeProps) {
  const { route, highlighted, onEdit } = data as RouteNodeData;
  const criteriaItems: string[] = [];
  if (route.criteria.channelId) criteriaItems.push(`ch:${route.criteria.channelId}`);
  if (route.criteria.isDm) criteriaItems.push('DM');
  if (route.criteria.isMention) criteriaItems.push('mention');
  if (route.criteria.senderId) criteriaItems.push(`from:${route.criteria.senderId}`);
  if (criteriaItems.length === 0) criteriaItems.push('any');

  return (
    <div
      onClick={() => onEdit(route)}
      style={{
        background: highlighted ? '#fffbe6' : '#fff7e6',
        border: `2px solid ${highlighted ? '#52c41a' : '#fa8c16'}`,
        borderRadius: 8,
        padding: '10px 14px',
        minWidth: 160,
        cursor: 'pointer',
        boxShadow: highlighted ? '0 0 0 3px rgba(82,196,26,0.3)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
        ROUTE <span style={{ float: 'right', color: '#fa8c16' }}>P{route.priority}</span>
      </div>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{route.id}</div>
      <div style={{ marginTop: 4 }}>
        {criteriaItems.map((item) => (
          <Tag key={item} style={{ fontSize: 10, margin: '2px 2px 0 0' }}>
            {item}
          </Tag>
        ))}
      </div>
      {!route.enabled && (
        <Tag color="default" style={{ marginTop: 4, fontSize: 10 }}>
          disabled
        </Tag>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const NODE_TYPES = {
  channel: ChannelNode,
  recipient: RecipientNode,
  route: RouteNode,
};

// ─── Layout helpers ───────────────────────────────────────────────────────────

const COL_X = { channel: 0, route: 320, recipient: 650 };
const ROW_H = 140;
const PADDING_Y = 40;

function buildGraph(
  routes: Route[],
  channels: Channel[],
  recipients: Recipient[],
  highlightedRouteIds: string[],
  onEdit: (route: Route) => void,
  onConnect: (params: Connection) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  channels.forEach((c, i) => {
    nodes.push({
      id: `channel-${c.id}`,
      type: 'channel',
      position: { x: COL_X.channel, y: PADDING_Y + i * ROW_H },
      data: { channel: c },
    });
  });

  recipients.forEach((r, i) => {
    nodes.push({
      id: `recipient-${r.id}`,
      type: 'recipient',
      position: { x: COL_X.recipient, y: PADDING_Y + i * ROW_H },
      data: { recipient: r },
    });
  });

  routes.forEach((route, i) => {
    nodes.push({
      id: `route-${route.id}`,
      type: 'route',
      position: { x: COL_X.route, y: PADDING_Y + i * ROW_H },
      data: {
        route,
        highlighted: highlightedRouteIds.includes(route.id),
        onEdit,
      },
    });

    // Edge: channel → route (if criteria.channelId is set)
    if (route.criteria.channelId) {
      const sourceId = `channel-${route.criteria.channelId}`;
      if (nodes.some((n) => n.id === sourceId)) {
        edges.push({
          id: `e-ch-${route.id}`,
          source: sourceId,
          target: `route-${route.id}`,
          animated: highlightedRouteIds.includes(route.id),
          style: { stroke: '#1677ff', strokeWidth: 2 },
        });
      }
    }

    // Edge: route → recipient
    const targetId = `recipient-${route.recipientId}`;
    if (nodes.some((n) => n.id === targetId)) {
      edges.push({
        id: `e-rt-${route.id}`,
        source: `route-${route.id}`,
        target: targetId,
        animated: highlightedRouteIds.includes(route.id),
        style: { stroke: '#52c41a', strokeWidth: 2 },
      });
    }
  });

  // Suppress unused warning — onConnect wired to ReactFlow below
  void onConnect;

  return { nodes, edges };
}

// ─── Main canvas component ───────────────────────────────────────────────────

interface RouteFlowCanvasProps {
  routes: Route[];
  channels: Channel[];
  recipients: Recipient[];
  highlightedRouteIds: string[];
  onEditRoute: (route: Route) => void;
  onCreateRoute: (defaults: Partial<Route>) => void;
  onDeleteRoute: (id: string) => void;
}

export default function RouteFlowCanvas({
  routes,
  channels,
  recipients,
  highlightedRouteIds,
  onEditRoute,
  onCreateRoute,
}: RouteFlowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const onConnect = useCallback(
    (params: Connection) => {
      // Dragging from a channel node to a recipient node → open create drawer
      if (params.source?.startsWith('channel-') && params.target?.startsWith('recipient-')) {
        const channelId = params.source.replace('channel-', '');
        const recipientId = params.target.replace('recipient-', '');
        onCreateRoute({
          criteria: { channelId },
          recipientId,
          priority: routes.length * 10 + 10,
        });
      }
      setEdges((eds) => addEdge(params, eds));
    },
    [routes, onCreateRoute, setEdges],
  );

  useEffect(() => {
    const { nodes: n, edges: e } = buildGraph(
      routes,
      channels,
      recipients,
      highlightedRouteIds,
      onEditRoute,
      onConnect,
    );
    setNodes(n);
    setEdges(e);
  }, [routes, channels, recipients, highlightedRouteIds, onEditRoute, onConnect, setNodes, setEdges]);

  const isEmpty = routes.length === 0 && channels.length === 0 && recipients.length === 0;

  return (
    <div style={{ height: 500, width: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap
          nodeStrokeWidth={3}
          nodeColor={(n) => {
            if (n.type === 'channel') return '#1677ff';
            if (n.type === 'recipient') return '#52c41a';
            return '#fa8c16';
          }}
        />
        {isEmpty && (
          <Panel position="top-center">
            <div
              style={{
                background: '#fff',
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid #e8e8e8',
                color: '#666',
                fontSize: 13,
              }}
            >
              Add channels, recipients, and routes to see the flow visualization
            </div>
          </Panel>
        )}
        {!isEmpty && routes.length === 0 && (
          <Panel position="top-center">
            <div
              style={{
                background: '#fff',
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid #e8e8e8',
                color: '#666',
                fontSize: 13,
              }}
            >
              Drag from a channel node to a recipient node to create a route
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
