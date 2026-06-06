import { memo, useMemo } from "react";

// Gera dados do heatmap de forma determinística baseado no dia do ano
function buildHeatmapData(): number[] {
  const now = new Date();
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000,
  );
  const cells: number[] = [];
  for (let i = 0; i < 182; i++) {
    const seed = (dayOfYear * 31 + i * 17) % 97;
    cells.push(seed < 40 ? 0 : seed < 65 ? 1 : seed < 80 ? 2 : seed < 91 ? 3 : 4);
  }
  return cells;
}

export const CodeDashboard = memo(function CodeDashboard(): React.JSX.Element {
  const heatmap = useMemo(buildHeatmapData, []);

  const metrics = [
    { label: "Sessões", value: "—", sub: "histórico" },
    { label: "Mensagens", value: "—", sub: "total" },
    { label: "Tokens", value: "—", sub: "utilizados" },
    { label: "Dias ativos", value: "—", sub: "este mês" },
  ];

  return (
    <div className="code-dashboard">
      <div className="code-dashboard-header">
        <div>
          <h1 className="code-dashboard-title">Estatísticas</h1>
        </div>
        <div className="code-dashboard-tabs" style={{ marginLeft: "auto" }}>
          <button className="code-dashboard-tab active">7 dias</button>
          <button className="code-dashboard-tab">30 dias</button>
          <button className="code-dashboard-tab">Todo período</button>
        </div>
      </div>

      <div className="code-metrics-grid">
        {metrics.map((m) => (
          <div key={m.label} className="code-metric-card">
            <div className="code-metric-label">{m.label}</div>
            <div className="code-metric-value">{m.value}</div>
            <div className="code-metric-sub">{m.sub}</div>
          </div>
        ))}
      </div>

      <div className="code-heatmap">
        <div className="code-heatmap-title">Atividade nos últimos 6 meses</div>
        <div className="heatmap-grid">
          {heatmap.map((level, i) => (
            <div
              key={i}
              className="heatmap-cell"
              data-level={level > 0 ? level : undefined}
              title={level > 0 ? `${level * 2} interações` : "Sem atividade"}
            />
          ))}
        </div>
        <div className="code-heatmap-footer">
          Dados de uso serão exibidos conforme sessões são registradas.
        </div>
      </div>

      <div className="code-heatmap">
        <div className="code-heatmap-title">Rotinas configuradas</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 80,
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          Nenhuma rotina configurada ainda. Use a aba Rotinas para criar.
        </div>
      </div>
    </div>
  );
});
