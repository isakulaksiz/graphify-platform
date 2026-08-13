import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphNode } from "../types";

/** Node etiketine göre renk — lejant ve düğümler aynı paleti kullanır. */
const LABEL_COLORS: Record<string, string> = {
  File: "#60a5fa",
  Folder: "#38bdf8",
  Function: "#34d399",
  Method: "#10b981",
  Class: "#f472b6",
  Interface: "#c084fc",
  Module: "#fbbf24",
  Route: "#fb923c",
  Resource: "#f87171",
  Variable: "#94a3b8",
  Package: "#a78bfa",
  Type: "#22d3ee",
};
const DEFAULT_COLOR = "#6b7280";

function colorFor(label: string): string {
  return LABEL_COLORS[label] ?? DEFAULT_COLOR;
}

interface Positioned extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/**
 * Basit force-directed yerleşim.
 *
 * d3-force yerine elle yazıldı: tek bağımlılık eklemeden yeterli sonuç veriyor
 * ve davranışı tümüyle bizim kontrolümüzde. Üç kuvvet var — merkeze çekim,
 * düğümler arası itme, kenarlar boyunca yay.
 */
function layout(data: GraphData, width: number, height: number, steps = 400): Positioned[] {
  const count = Math.max(1, data.nodes.length);

  const nodes: Positioned[] = data.nodes.map((node, index) => {
    // Deterministik başlangıç: aynı graf her açılışta aynı yerleşimi versin.
    // Altın açı spirali düğümleri baştan tuvale yayar; merkeze yığılıp
    // birbirini itmeye çalışan bir başlangıçtan çok daha hızlı oturur.
    const angle = index * 2.399963;
    const radius = Math.sqrt(index / count) * (Math.min(width, height) / 2 - 30);
    return {
      ...node,
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      r: 3 + Math.min(9, Math.sqrt(node.degree) * 1.6),
    };
  });

  const index = new Map(nodes.map((node) => [node.id, node]));
  const links = data.edges
    .map((edge) => ({ s: index.get(edge.source), t: index.get(edge.target) }))
    .filter((link): link is { s: Positioned; t: Positioned } => !!link.s && !!link.t);

  const centerX = width / 2;
  const centerY = height / 2;

  for (let step = 0; step < steps; step++) {
    // Sıcaklık: başta büyük hareketler, sonra sakinleşme.
    const alpha = 1 - step / steps;

    // İtme — her düğüm çifti birbirini iter.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distanceSq = dx * dx + dy * dy;
        if (distanceSq < 0.01) {
          // Üst üste binmiş düğümleri deterministik biçimde ayır.
          dx = (i % 2 === 0 ? 1 : -1) * 0.5;
          dy = (j % 2 === 0 ? 1 : -1) * 0.5;
          distanceSq = dx * dx + dy * dy;
        }
        const distance = Math.sqrt(distanceSq);
        // Kuvveti sınırlıyoruz: çok yakın düğümler aksi halde birbirini
        // tuvalin dışına fırlatır ve yerleşim patlar.
        const force = Math.min(30, (2600 * alpha) / distanceSq);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Yay — bağlı düğümler birbirini çeker.
    for (const { s, t } of links) {
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (distance - 78) * 0.009 * alpha;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    // Merkeze hafif çekim + sürtünme.
    for (const node of nodes) {
      node.vx += (centerX - node.x) * 0.0022 * alpha;
      node.vy += (centerY - node.y) * 0.0022 * alpha;
      node.vx *= 0.82;
      node.vy *= 0.82;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  return nodes;
}

export function GraphView({ data }: { data: GraphData }) {
  const width = 900;
  const height = 520;
  const [hovered, setHovered] = useState<Positioned | null>(null);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  // Yerleşim pahalı; yalnızca veri değişince hesapla.
  const nodes = useMemo(() => layout(data, width, height), [data]);
  const positions = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const usedLabels = useMemo(
    () => [...new Set(nodes.map((n) => n.label))].sort(),
    [nodes],
  );

  // Fare tekerleğiyle yakınlaştırma — sayfanın kaymasını engelle.
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      setZoom((previous) => Math.min(4, Math.max(0.4, previous * (event.deltaY < 0 ? 1.12 : 0.89))));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const viewWidth = width / zoom;
  const viewHeight = height / zoom;
  const viewBox = `${(width - viewWidth) / 2} ${(height - viewHeight) / 2} ${viewWidth} ${viewHeight}`;

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-[var(--color-edge)] bg-[var(--color-canvas)]">
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className="block h-[520px] w-full cursor-crosshair"
          role="img"
          aria-label="Kod grafı"
        >
          <g opacity="0.25" stroke="#64748b" strokeWidth="0.7">
            {data.edges.map((edge, i) => {
              const s = positions.get(edge.source);
              const t = positions.get(edge.target);
              if (!s || !t) return null;
              return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} />;
            })}
          </g>

          {nodes.map((node) => (
            <circle
              key={node.id}
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill={colorFor(node.label)}
              fillOpacity={hovered && hovered.id !== node.id ? 0.25 : 0.9}
              stroke={hovered?.id === node.id ? "#fff" : "none"}
              strokeWidth="1.5"
              onMouseEnter={() => setHovered(node)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>

        {hovered && (
          <div className="pointer-events-none absolute left-3 top-3 max-w-sm rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)]/95 px-3 py-2 text-xs">
            <p className="font-medium text-gray-100">{hovered.name}</p>
            <p className="mt-0.5 text-gray-400">
              <span style={{ color: colorFor(hovered.label) }}>{hovered.label}</span>
              {" · "}
              {hovered.degree} bağlantı
            </p>
            {hovered.filePath && (
              <p className="mt-0.5 break-all font-mono text-[11px] text-gray-500">
                {hovered.filePath}
              </p>
            )}
          </div>
        )}

        <p className="pointer-events-none absolute bottom-3 right-3 text-[11px] text-gray-600">
          tekerlek ile yakınlaştır · düğüm üzerine gelin
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {usedLabels.map((label) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-gray-400">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: colorFor(label) }}
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
