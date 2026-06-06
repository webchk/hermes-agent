import { useState, useCallback, useEffect, useRef } from "react";
import { Search, X, Download, Trash, Refresh } from "../../assets/icons";
import { BookOpen, Layers } from "lucide-react";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { useI18n } from "../../components/useI18n";

interface InstalledSkill {
  name: string;
  category: string;
  description: string;
  path: string;
}

interface BundledSkill {
  name: string;
  description: string;
  category: string;
  source: string;
  installed: boolean;
}

type Panel = "welcome" | "detail" | "browse";

// Skills are global — no profile passed to API calls
function Skills(_props: { profile?: string }): React.JSX.Element {
  const { t } = useI18n();
  const [panel, setPanel] = useState<Panel>("welcome");
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [bundledSkills, setBundledSkills] = useState<BundledSkill[]>([]);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [browseSearch, setBrowseSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSkill, setSelectedSkill] = useState<InstalledSkill | null>(null);
  const [detailContent, setDetailContent] = useState("");
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState("");
  const browseSearchRef = useRef<HTMLInputElement>(null);

  // Global: no profile arg
  const loadInstalled = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listInstalledSkills();
    setInstalledSkills(list);
  }, []);

  const loadBundled = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listBundledSkills();
    setBundledSkills(list);
  }, []);

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true);
    await Promise.all([loadInstalled(), loadBundled()]);
    setLoading(false);
  }, [loadInstalled, loadBundled]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleSelectSkill(skill: InstalledSkill): Promise<void> {
    setSelectedSkill(skill);
    setPanel("detail");
    const content = await window.hermesAPI.getSkillContent(skill.path);
    setDetailContent(content);
  }

  async function handleInstall(name: string): Promise<void> {
    setActionInProgress(name);
    setError("");
    const result = await window.hermesAPI.installSkill(name); // global
    setActionInProgress(null);
    if (result.success) {
      await loadInstalled();
    } else {
      setError(result.error || t("skills.installFailed"));
    }
  }

  async function handleUninstall(name: string): Promise<void> {
    setActionInProgress(name);
    setError("");
    const result = await window.hermesAPI.uninstallSkill(name); // global
    setActionInProgress(null);
    if (result.success) {
      setSelectedSkill(null);
      setPanel("welcome");
      await loadInstalled();
    } else {
      setError(result.error || t("skills.uninstallFailed"));
    }
  }

  // Sidebar: group installed skills by category
  const filteredInstalled = installedSkills.filter((s) => {
    if (!sidebarSearch) return true;
    const q = sidebarSearch.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q);
  });

  const installedByCategory = filteredInstalled.reduce<Record<string, InstalledSkill[]>>(
    (acc, s) => {
      (acc[s.category] ??= []).push(s);
      return acc;
    },
    {},
  );

  // Browse panel: filter bundled
  const installedNames = new Set(installedSkills.map((s) => s.name.toLowerCase()));
  const browseCategories = Array.from(new Set(bundledSkills.map((s) => s.category))).sort();
  const filteredBundled = bundledSkills.filter((s) => {
    let ok = !categoryFilter || s.category === categoryFilter;
    if (browseSearch) {
      const q = browseSearch.toLowerCase();
      ok = ok && (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    }
    return ok;
  });

  if (loading) {
    return (
      <div className="sk-shell">
        <div className="sk-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="sk-shell">
      {/* ── Left sidebar ─────────────────────────── */}
      <aside className="sk-panel">
        <div className="sk-panel-top">
          <div className="sk-panel-search">
            <Search size={13} />
            <input
              className="sk-panel-search-input"
              placeholder="Filtrar skills…"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
            />
            {sidebarSearch && (
              <button className="btn-ghost" style={{ padding: 0 }} onClick={() => setSidebarSearch("")}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="sk-panel-list">
          {installedSkills.length === 0 ? (
            <div className="sk-panel-empty">Nenhuma skill instalada</div>
          ) : (
            <>
              <div className="sk-panel-section-label">
                Instaladas · {installedSkills.length}
              </div>
              {Object.keys(installedByCategory).sort().map((cat) => (
                <div key={cat} className="sk-panel-category">
                  <div className="sk-panel-cat-label">
                    <Layers size={11} />
                    {cat}
                  </div>
                  {installedByCategory[cat].map((skill) => (
                    <button
                      key={skill.path}
                      className={`sk-panel-item${selectedSkill?.path === skill.path && panel === "detail" ? " active" : ""}`}
                      onClick={() => handleSelectSkill(skill)}
                    >
                      <BookOpen size={12} />
                      <span className="sk-panel-item-name">{skill.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="sk-panel-foot">
          <button
            className={`sk-browse-btn${panel === "browse" ? " active" : ""}`}
            onClick={() => { setPanel("browse"); setSelectedSkill(null); }}
          >
            <Download size={13} />
            <span>Explorar e instalar</span>
          </button>
          <button
            className="sk-refresh-btn"
            onClick={loadAll}
            title="Atualizar"
          >
            <Refresh size={13} />
          </button>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────── */}
      <main className="sk-main">
        {error && (
          <div className="sk-error-bar">
            {error}
            <button className="btn-ghost" onClick={() => setError("")}><X size={13} /></button>
          </div>
        )}

        {/* Welcome */}
        {panel === "welcome" && (
          <div className="sk-welcome">
            <div className="sk-welcome-icon">
              <BookOpen size={32} />
            </div>
            <h2 className="sk-welcome-title">Skills do Hermes</h2>
            <p className="sk-welcome-sub">
              Skills são habilidades especializadas que expandem o que o Hermes sabe fazer.
              Elas ficam disponíveis em <strong>todos os workspaces</strong>.
            </p>
            <p className="sk-welcome-hint">
              Selecione uma skill instalada na barra lateral, ou clique em{" "}
              <strong>Explorar e instalar</strong> para descobrir novas.
            </p>
          </div>
        )}

        {/* Skill detail */}
        {panel === "detail" && selectedSkill && (
          <div className="sk-detail">
            <div className="sk-detail-header">
              <div>
                <h2 className="sk-detail-name">{selectedSkill.name}</h2>
                <span className="sk-detail-category">{selectedSkill.category}</span>
              </div>
              <button
                className="sk-detail-remove-btn"
                onClick={() => handleUninstall(selectedSkill.name)}
                disabled={actionInProgress === selectedSkill.name}
              >
                {actionInProgress === selectedSkill.name ? (
                  <span>{t("skills.removing")}</span>
                ) : (
                  <>
                    <Trash size={13} />
                    <span>{t("skills.uninstall")}</span>
                  </>
                )}
              </button>
            </div>
            {selectedSkill.description && (
              <p className="sk-detail-desc">{selectedSkill.description}</p>
            )}
            <div className="sk-detail-body">
              {detailContent ? (
                <AgentMarkdown>{detailContent}</AgentMarkdown>
              ) : (
                <div className="sk-detail-loading">
                  <div className="loading-spinner" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Browse & Install */}
        {panel === "browse" && (
          <div className="sk-browse">
            <div className="sk-browse-header">
              <h2 className="sk-browse-title">Explorar skills</h2>
              <div className="sk-browse-search-wrap">
                <Search size={13} />
                <input
                  ref={browseSearchRef}
                  className="sk-browse-search"
                  placeholder="Buscar…"
                  value={browseSearch}
                  onChange={(e) => setBrowseSearch(e.target.value)}
                  autoFocus
                />
                {browseSearch && (
                  <button className="btn-ghost" style={{ padding: 0 }} onClick={() => setBrowseSearch("")}>
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {browseCategories.length > 0 && (
              <div className="sk-browse-pills">
                <button
                  className={`sk-pill${categoryFilter === null ? " active" : ""}`}
                  onClick={() => setCategoryFilter(null)}
                >
                  Todas
                </button>
                {browseCategories.map((cat) => (
                  <button
                    key={cat}
                    className={`sk-pill${categoryFilter === cat ? " active" : ""}`}
                    onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}

            {filteredBundled.length === 0 ? (
              <div className="sk-browse-empty">
                <p>{t("skills.noBrowseResults")}</p>
              </div>
            ) : (
              <div className="sk-cards">
                {filteredBundled.map((skill) => {
                  const installed = installedNames.has(skill.name.toLowerCase());
                  const actioning = actionInProgress === skill.name;
                  return (
                    <div key={`${skill.category}/${skill.name}`} className="sk-card">
                      <div className="sk-card-cat">{skill.category}</div>
                      <div className="sk-card-name">{skill.name}</div>
                      {skill.description && (
                        <div className="sk-card-desc">{skill.description}</div>
                      )}
                      <div className="sk-card-footer">
                        {installed ? (
                          <span className="sk-card-badge">Instalada</span>
                        ) : (
                          <button
                            className="sk-card-install-btn"
                            onClick={() => handleInstall(skill.name)}
                            disabled={actioning}
                          >
                            {actioning ? (
                              t("skills.installing")
                            ) : (
                              <>
                                <Download size={12} />
                                {t("skills.install")}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default Skills;
