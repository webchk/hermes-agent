import { useState, useEffect } from "react";
import { X, ChevronRight, Plus, FolderOpen, Copy, ArrowLeft, Info } from "lucide-react";
import {
  WORKSPACE_ICON_MAP,
  WORKSPACE_ICON_NAMES,
} from "./WorkspaceCard";

type CreateType = "blank" | "folder" | "clone";

const PRESET_COLORS = [
  "#6b7280", "#3b82f6", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
  "#f97316", "#06b6d4",
];

interface WorkspaceCreateModalProps {
  onConfirm: (
    name: string,
    displayName: string,
    icon: string,
    color: string,
    clone: boolean,
    workingDirectory?: string | null,
  ) => void;
  onCancel: () => void;
}

export function WorkspaceCreateModal({
  onConfirm,
  onCancel,
}: WorkspaceCreateModalProps): React.JSX.Element {
  const [step, setStep] = useState<0 | 1>(0);
  const [createType, setCreateType] = useState<CreateType>("blank");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("folder");
  const [color, setColor] = useState("#3b82f6");
  const [workingDirectory, setWorkingDirectory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createOptions: {
    type: CreateType;
    Icon: React.ElementType;
    title: string;
    desc: string;
    recommended?: boolean;
  }[] = [
    {
      type: "blank",
      Icon: Plus,
      title: "Começar do zero",
      desc: "Configure um novo workspace com instruções e arquivos.",
      recommended: true,
    },
    {
      type: "folder",
      Icon: FolderOpen,
      title: "Usar pasta existente",
      desc: "Dê ao Hermes uma pasta da qual você já trabalha.",
    },
    {
      type: "clone",
      Icon: Copy,
      title: "Clonar workspace atual",
      desc: "Traga as configurações e skills do workspace atual.",
    },
  ];

  function folderBasename(path: string): string {
    return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
  }

  function toTechName(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9_-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 63);
  }

  function handleSelectType(type: CreateType): void {
    setCreateType(type);
    setStep(1);
  }

  async function handleSelectFolder(): Promise<void> {
    const path = await window.hermesAPI.selectFolder();
    if (!path) return;
    setWorkingDirectory(path);
    const base = folderBasename(path);
    setDisplayName(base);
  }

  // For "folder" type, auto-open the folder picker on mount
  useEffect(() => {
    if (step === 1 && createType === "folder") {
      handleSelectFolder();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, createType]);

  function handleSubmit(): void {
    if (createType === "folder") {
      if (!workingDirectory) {
        setError("Selecione uma pasta");
        return;
      }
      const techName = toTechName(folderBasename(workingDirectory));
      if (techName.length < 2) {
        setError("Nome da pasta muito curto");
        return;
      }
      onConfirm(techName, displayName || techName, icon, color, false, workingDirectory);
      return;
    }
    const dn = displayName.trim();
    if (!dn) {
      setError("Nome obrigatório");
      return;
    }
    const techName = toTechName(dn);
    if (techName.length < 2) {
      setError("Nome deve ter ao menos 2 caracteres");
      return;
    }
    onConfirm(techName, dn, icon, color, createType === "clone", workingDirectory);
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Escape") onCancel();
  }

  /* ── Step 0: Choose type ─────────────────────────────────────────── */
  if (step === 0) {
    return (
      <div className="wc-overlay" onClick={onCancel}>
        <div className="wc-box" onClick={(e) => e.stopPropagation()}>
          <div className="wc-header">
            <div className="wc-header-text">
              <h2 className="wc-title">Criar um novo workspace</h2>
              <p className="wc-subtitle">
                Um lugar dedicado para trabalho contínuo, onde o contexto se
                acumula ao longo do tempo. Arquivos e instruções ficam em uma
                pasta no seu computador.
              </p>
            </div>
            <button className="wc-close" onClick={onCancel} aria-label="Fechar">
              <X size={16} />
            </button>
          </div>

          <div className="wc-options">
            {createOptions.map(({ type, Icon, title, desc, recommended }) => (
              <button
                key={type}
                className={`wc-option${recommended ? " wc-option--recommended" : ""}`}
                onClick={() => handleSelectType(type)}
              >
                <span className="wc-option-icon">
                  <Icon size={20} />
                </span>
                <span className="wc-option-body">
                  <span className="wc-option-title">{title}</span>
                  <span className="wc-option-desc">{desc}</span>
                </span>
                <ChevronRight size={16} className="wc-option-chevron" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Step 1: Form ────────────────────────────────────────────────── */
  return (
    <div className="wc-overlay" onClick={onCancel}>
      <div
        className="wc-box"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="wc-header wc-header--form">
          <button
            className="wc-back"
            onClick={() => setStep(0)}
            aria-label="Voltar"
          >
            <ArrowLeft size={16} />
          </button>
          <h2 className="wc-title">
            {createType === "blank" && "Iniciar novo workspace"}
            {createType === "folder" && "Usar pasta existente"}
            {createType === "clone" && "Clonar workspace"}
          </h2>
          <button className="wc-close" onClick={onCancel} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="wc-body">
          {createType === "folder" ? (
            /* ── Folder import: simplified ── */
            <>
              <div className="wc-field">
                <label className="wc-label">
                  Pasta do projeto <span className="wc-required">*</span>
                </label>
                <div className="wc-folder-row">
                  <div className="wc-folder-path">
                    {workingDirectory ?? "Nenhuma pasta selecionada"}
                  </div>
                  <button
                    type="button"
                    className="wc-folder-btn"
                    onClick={handleSelectFolder}
                  >
                    <FolderOpen size={13} />
                  </button>
                </div>
                {workingDirectory && (
                  <span className="wc-hint">
                    Nome do workspace: <strong>{displayName}</strong>
                  </span>
                )}
              </div>

              {error && <div className="wc-error">{error}</div>}
            </>
          ) : (
            /* ── Blank / Clone: full form ── */
            <>
              {/* Nome */}
              <div className="wc-field">
                <label className="wc-label" htmlFor="wc-display-name">
                  Nome de exibição <span className="wc-required">*</span>
                </label>
                <input
                  id="wc-display-name"
                  className="wc-input"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="ex: Empresa A, Projeto RAG"
                  autoFocus
                />
              </div>

              {/* Instruções */}
              <div className="wc-field">
                <label className="wc-label" htmlFor="wc-desc">
                  Instruções
                </label>
                <textarea
                  id="wc-desc"
                  className="wc-textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Diga ao Hermes como trabalhar neste workspace (opcional)"
                  rows={3}
                />
              </div>

              {/* Ícone + Cor */}
              <div className="wc-field">
                <label className="wc-label">Personalizar</label>
                <div className="wc-customize-row">
                  <div className="wc-icon-strip">
                    {WORKSPACE_ICON_NAMES.map((n) => {
                      const Icon = WORKSPACE_ICON_MAP[n];
                      return (
                        <button
                          key={n}
                          type="button"
                          title={n}
                          className={`wc-icon-btn${icon === n ? " selected" : ""}`}
                          style={
                            icon === n
                              ? { borderColor: color, background: `${color}1a`, color }
                              : {}
                          }
                          onClick={() => setIcon(n)}
                        >
                          <Icon size={14} />
                        </button>
                      );
                    })}
                  </div>
                  <div className="wc-color-strip">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`wc-color-btn${color === c ? " selected" : ""}`}
                        style={{ background: c, outline: color === c ? `2px solid ${c}` : undefined }}
                        onClick={() => setColor(c)}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Pasta opcional */}
              <div className="wc-field">
                <label className="wc-label">
                  Local do workspace
                  <Info size={12} className="wc-info-icon" />
                </label>
                <div className="wc-folder-row">
                  <div className="wc-folder-path">
                    {workingDirectory ?? "Nenhuma pasta (opcional)"}
                  </div>
                  <button
                    type="button"
                    className="wc-folder-btn"
                    onClick={handleSelectFolder}
                  >
                    <FolderOpen size={13} />
                  </button>
                </div>
              </div>

              {error && <div className="wc-error">{error}</div>}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="wc-footer">
          <span className="wc-footer-meta">
            {createType === "clone" ? "Clonando configurações" : createType === "folder" ? "Importando pasta" : "Workspace novo"}
          </span>
          <button className="wc-btn-cancel" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="wc-btn-create"
            onClick={handleSubmit}
            disabled={createType === "folder" && !workingDirectory}
          >
            Criar
          </button>
        </div>
      </div>
    </div>
  );
}
