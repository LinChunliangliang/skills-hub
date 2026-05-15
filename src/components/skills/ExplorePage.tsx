import { memo, useMemo, useState } from 'react'
import { Plus, RefreshCw, Search, Star } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { FeaturedSkillDto, ManagedSkill, OnlineSkillDto, PrivateSkillDto } from './types'

type ExplorePageProps = {
  featuredSkills: FeaturedSkillDto[]
  featuredLoading: boolean
  exploreFilter: string
  searchResults: OnlineSkillDto[]
  searchLoading: boolean
  managedSkills: ManagedSkill[]
  loading: boolean
  privateSkills: PrivateSkillDto[]
  privateSkillsLoading: boolean
  privateSourceConfigured: boolean
  selectedPrivateSkills: Record<string, boolean>
  onExploreFilterChange: (value: string) => void
  onInstallSkill: (sourceUrl: string, skillName?: string) => void
  onOpenManualAdd: () => void
  onRefreshPrivateSkills: () => void
  onTogglePrivateSkill: (path: string) => void
  onImportPrivateSkills: () => void
  onUpdatePrivateSkill: (path: string, sha: string) => void
  t: TFunction
}

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

const ExplorePage = ({
  featuredSkills,
  featuredLoading,
  exploreFilter,
  searchResults,
  searchLoading,
  managedSkills,
  loading,
  privateSkills,
  privateSkillsLoading,
  privateSourceConfigured,
  selectedPrivateSkills,
  onExploreFilterChange,
  onInstallSkill,
  onOpenManualAdd,
  onRefreshPrivateSkills,
  onTogglePrivateSkill,
  onImportPrivateSkills,
  onUpdatePrivateSkill,
  t,
}: ExplorePageProps) => {
  const [activeTab, setActiveTab] = useState<'public' | 'internal'>('public')

  const filteredSkills = useMemo(() => {
    if (!exploreFilter.trim()) return featuredSkills
    const lower = exploreFilter.toLowerCase()
    return featuredSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.summary.toLowerCase().includes(lower),
    )
  }, [featuredSkills, exploreFilter])

  const deduplicatedResults = useMemo(() => {
    const featuredNames = new Set(filteredSkills.map((s) => s.name.toLowerCase()))
    return searchResults.filter((s) => !featuredNames.has(s.name.toLowerCase()))
  }, [searchResults, filteredSkills])

  const isSearchActive = exploreFilter.trim().length >= 2

  const installedSkillKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const skill of managedSkills) {
      const source = (skill.source_ref ?? '')
        .replace('https://github.com/', '')
        .replace(/\.git$/, '')
        .split('/tree/')[0]
        .toLowerCase()
      keys.add(`${skill.name.toLowerCase()}|${source}`)
    }
    return keys
  }, [managedSkills])

  const isInstalled = (skillName: string, source: string) => {
    const normalizedSource = source
      .replace('https://github.com/', '')
      .replace(/\.git$/, '')
      .split('/tree/')[0]
      .toLowerCase()
    return installedSkillKeys.has(`${skillName.toLowerCase()}|${normalizedSource}`)
  }

  const selectedCount = Object.values(selectedPrivateSkills).filter(Boolean).length
  const uninstalledPrivateSkills = privateSkills.filter((s) => s.install_status === 'not_installed')

  return (
    <div className="explore-page">
      <div className="explore-hero">
        <div className="explore-tab-bar">
          <button
            type="button"
            className={`explore-tab-btn ${activeTab === 'public' ? 'active' : ''}`}
            onClick={() => setActiveTab('public')}
          >
            {t('explorePublicTab')}
          </button>
          <button
            type="button"
            className={`explore-tab-btn ${activeTab === 'internal' ? 'active' : ''}`}
            onClick={() => setActiveTab('internal')}
          >
            {t('exploreInternalTab')}
          </button>
        </div>

        {activeTab === 'public' && (
          <div className="explore-search-row">
            <div className="explore-search-wrap">
              <Search size={16} className="explore-search-icon" />
              <input
                className="explore-search-input"
                placeholder={t('exploreFilterPlaceholder')}
                value={exploreFilter}
                onChange={(e) => onExploreFilterChange(e.target.value)}
              />
            </div>
            <button
              className="btn btn-secondary explore-manual-btn"
              type="button"
              onClick={onOpenManualAdd}
              disabled={loading}
            >
              <Plus size={15} />
              {t('manualAdd')}
            </button>
          </div>
        )}

        {activeTab === 'public' && (
          <div className="explore-source-label">{t('exploreSourceHint')}</div>
        )}
      </div>

      <div className="explore-scroll">
        {/* ── Public tab ── */}
        {activeTab === 'public' && (
          <>
            {featuredLoading ? (
              <div className="explore-loading">{t('exploreLoading')}</div>
            ) : (
              <>
                {isSearchActive && filteredSkills.length > 0 && (
                  <div className="explore-section-title">{t('exploreFeaturedTitle')}</div>
                )}
                {filteredSkills.length > 0 ? (
                  <div className="explore-grid">
                    {filteredSkills.map((skill) => {
                      const installed = isInstalled(skill.name, skill.source_url)
                      return (
                        <div key={skill.slug} className="explore-card">
                          <div className="explore-card-top">
                            <div className="explore-card-info">
                              <div className="explore-card-name">{skill.name}</div>
                              <div className="explore-card-author">
                                {skill.source_url
                                  .replace('https://github.com/', '')
                                  .split('/tree/')[0]}
                              </div>
                            </div>
                            {installed ? (
                              <span className="explore-btn-installed">{t('status.installed')}</span>
                            ) : (
                              <button
                                className="explore-btn-install"
                                type="button"
                                disabled={loading}
                                onClick={() => onInstallSkill(skill.source_url)}
                              >
                                {t('install')}
                              </button>
                            )}
                          </div>
                          <div className="explore-card-desc">{skill.summary}</div>
                          <div className="explore-card-bottom">
                            <div className="explore-card-stats">
                              <span className="explore-stat">
                                <Star size={12} />
                                {formatCount(skill.stars)}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : !isSearchActive ? (
                  <div className="explore-empty">{t('exploreEmpty')}</div>
                ) : null}

                {isSearchActive && (
                  <>
                    <div className="explore-section-title">{t('exploreOnlineTitle')}</div>
                    {searchLoading ? (
                      <div className="explore-loading">{t('searchLoading')}</div>
                    ) : deduplicatedResults.length > 0 ? (
                      <div className="explore-grid">
                        {deduplicatedResults.map((skill) => {
                          const installed = isInstalled(skill.name, skill.source_url)
                          return (
                            <div key={skill.source} className="explore-card">
                              <div className="explore-card-top">
                                <div className="explore-card-info">
                                  <div className="explore-card-name">{skill.name}</div>
                                  <div className="explore-card-author">{skill.source}</div>
                                </div>
                                {installed ? (
                                  <span className="explore-btn-installed">{t('status.installed')}</span>
                                ) : (
                                  <button
                                    className="explore-btn-install"
                                    type="button"
                                    disabled={loading}
                                    onClick={() => onInstallSkill(skill.source_url, skill.name)}
                                  >
                                    {t('install')}
                                  </button>
                                )}
                              </div>
                              <div className="explore-card-bottom">
                                <div className="explore-card-stats">
                                  <span className="explore-stat">
                                    {formatCount(skill.installs)} installs
                                  </span>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="explore-empty">{t('searchEmpty')}</div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ── Internal tab ── */}
        {activeTab === 'internal' && (
          <div className="internal-panel">
            {!privateSourceConfigured ? (
              <div className="explore-empty">{t('internalNotConfigured')}</div>
            ) : (
              <>
                <div className="internal-toolbar">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm internal-refresh-btn"
                    onClick={onRefreshPrivateSkills}
                    disabled={privateSkillsLoading}
                  >
                    <RefreshCw size={13} />
                    {t('internalRefresh')}
                  </button>
                  {selectedCount > 0 && (
                    <span className="internal-selected-label">
                      {t('internalSelected', { count: selectedCount })}
                    </span>
                  )}
                  {selectedCount > 0 && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={onImportPrivateSkills}
                      disabled={loading}
                    >
                      {t('internalImportSelected')}
                    </button>
                  )}
                </div>

                {privateSkillsLoading ? (
                  <div className="explore-loading">{t('internalLoading')}</div>
                ) : privateSkills.length === 0 ? (
                  <div className="explore-empty">{t('internalEmpty')}</div>
                ) : (
                  <div className="internal-skill-list">
                    {privateSkills.map((skill) => (
                      <div key={skill.path} className="internal-skill-row">
                        {skill.install_status === 'not_installed' ? (
                          <input
                            type="checkbox"
                            className="internal-checkbox"
                            checked={!!selectedPrivateSkills[skill.path]}
                            onChange={() => onTogglePrivateSkill(skill.path)}
                          />
                        ) : (
                          <span className="internal-checkbox-placeholder" />
                        )}

                        <div className="internal-skill-info">
                          <div className="internal-skill-name">{skill.name}</div>
                          {skill.description && (
                            <div className="internal-skill-desc">{skill.description}</div>
                          )}
                        </div>

                        <div className="internal-skill-actions">
                          {skill.install_status === 'installed' && (
                            <span className="internal-badge-installed">
                              {t('internalInstalled')}
                            </span>
                          )}
                          {skill.install_status === 'update_available' && (
                            <button
                              type="button"
                              className="internal-badge-update"
                              onClick={() => onUpdatePrivateSkill(skill.path, skill.sha)}
                              disabled={loading}
                            >
                              {t('internalUpdate')}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {uninstalledPrivateSkills.length > 0 && selectedCount === 0 && !privateSkillsLoading && (
                  <div className="internal-footer-hint">
                    {t('internalSelected', { count: 0 })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(ExplorePage)
