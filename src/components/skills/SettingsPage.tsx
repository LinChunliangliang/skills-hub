import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { Update } from '@tauri-apps/plugin-updater'
import type { PrivateSourceConfig } from './types'

type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'done' | 'error'

function buildFolderUrl(cfg: PrivateSourceConfig | null): string {
  if (!cfg?.url) return ''
  return `${cfg.url}/${cfg.repo}`
}

function parseGogsUrl(raw: string): { url: string; repo: string; skills_path: string } | null {
  try {
    const u = new URL(raw.trim())
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    return { url: u.origin, repo: `${parts[0]}/${parts[1]}`, skills_path: '' }
  } catch {
    return null
  }
}

type SettingsPageProps = {
  isTauri: boolean
  language: string
  storagePath: string
  gitCacheCleanupDays: number
  gitCacheTtlSecs: number
  themePreference: 'system' | 'light' | 'dark'
  githubToken: string
  privateSourceConfig: PrivateSourceConfig | null
  onPickStoragePath: () => void
  onToggleLanguage: () => void
  onThemeChange: (nextTheme: 'system' | 'light' | 'dark') => void
  onGitCacheCleanupDaysChange: (nextDays: number) => void
  onGitCacheTtlSecsChange: (nextSecs: number) => void
  onClearGitCacheNow: () => void
  onGithubTokenChange: (token: string) => void
  onSavePrivateSource: (cfg: PrivateSourceConfig) => Promise<void>
  onTestPrivateSource: (cfg: PrivateSourceConfig) => Promise<string>
  onBack: () => void
  t: TFunction
}

const SettingsPage = ({
  isTauri,
  language,
  storagePath,
  gitCacheCleanupDays,
  gitCacheTtlSecs,
  themePreference,
  onPickStoragePath,
  onToggleLanguage,
  onThemeChange,
  onGitCacheCleanupDaysChange,
  onGitCacheTtlSecsChange,
  onClearGitCacheNow,
  githubToken,
  onGithubTokenChange,
  privateSourceConfig,
  onSavePrivateSource,
  onTestPrivateSource,
  onBack,
  t,
}: SettingsPageProps) => {
  const [localToken, setLocalToken] = useState(githubToken)
  useEffect(() => {
    setLocalToken(githubToken)
  }, [githubToken])

  const [psFolderUrl, setPsFolderUrl] = useState(() => buildFolderUrl(privateSourceConfig))
  const [psToken, setPsToken] = useState(privateSourceConfig?.token ?? '')
  const [psTestMsg, setPsTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [psSaving, setPsSaving] = useState(false)
  const [psTesting, setPsTesting] = useState(false)

  useEffect(() => {
    if (privateSourceConfig) {
      setPsFolderUrl(buildFolderUrl(privateSourceConfig))
      setPsToken(privateSourceConfig.token)
    }
  }, [privateSourceConfig])

  const parsedCfg = parseGogsUrl(psFolderUrl)

  const handleSavePrivateSource = useCallback(async () => {
    if (!parsedCfg) return
    setPsSaving(true)
    setPsTestMsg(null)
    try {
      await onSavePrivateSource({ ...parsedCfg, token: psToken })
      setPsTestMsg({ ok: true, text: t('privateSourceSaved') })
    } catch (err) {
      setPsTestMsg({ ok: false, text: String(err) })
    } finally {
      setPsSaving(false)
    }
  }, [onSavePrivateSource, parsedCfg, psToken, t])

  const handleTestPrivateSource = useCallback(async () => {
    if (!parsedCfg) return
    setPsTesting(true)
    setPsTestMsg(null)
    try {
      const user = await onTestPrivateSource({ ...parsedCfg, token: psToken })
      setPsTestMsg({ ok: true, text: t('privateSourceTestOk', { user }) })
    } catch (err) {
      setPsTestMsg({ ok: false, text: t('privateSourceTestFail', { error: String(err) }) })
    } finally {
      setPsTesting(false)
    }
  }, [onTestPrivateSource, parsedCfg, psToken, t])

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const updateRef = useRef<Update | null>(null)

  const handleCheckUpdate = useCallback(async () => {
    if (!isTauri) return
    setUpdateStatus('checking')
    setUpdateError(null)
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (update) {
        updateRef.current = update
        setUpdateVersion(update.version)
        setUpdateStatus('available')
      } else {
        setUpdateStatus('up-to-date')
      }
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err))
      setUpdateStatus('error')
    }
  }, [isTauri])

  const handleInstallUpdate = useCallback(async () => {
    const update = updateRef.current
    if (!update) return
    setUpdateStatus('downloading')
    setUpdateError(null)
    try {
      await update.downloadAndInstall()
      setUpdateStatus('done')
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err))
      setUpdateStatus('error')
    }
  }, [])

  const [appVersion, setAppVersion] = useState<string | null>(null)
  const versionText = useMemo(() => {
    if (!isTauri) return t('notAvailable')
    if (!appVersion) return t('unknown')
    return `v${appVersion}`
  }, [appVersion, isTauri, t])

  const loadAppVersion = useCallback(async () => {
    if (!isTauri) {
      setAppVersion(null)
      return
    }
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      const v = await getVersion()
      setAppVersion(v)
    } catch {
      setAppVersion(null)
    }
  }, [isTauri])

  useEffect(() => {
    void loadAppVersion()
    return () => { updateRef.current = null }
  }, [loadAppVersion])

  return (
    <div className="settings-page">
      <div className="detail-header">
        <button className="detail-back-btn" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          {t('detail.back')}
        </button>
        <div className="detail-skill-name">{t('settings')}</div>
      </div>
      <div className="settings-page-body">
        <div className="settings-field">
          <label className="settings-label" htmlFor="settings-language">
            {t('interfaceLanguage')}
          </label>
          <div className="settings-select-wrap">
            <select
              id="settings-language"
              className="settings-select"
              value={language}
              onChange={(event) => {
                if (event.target.value !== language) {
                  onToggleLanguage()
                }
              }}
            >
              <option value="en">{t('languageOptions.en')}</option>
              <option value="zh">{t('languageOptions.zh')}</option>
            </select>
            <svg
              className="settings-select-caret"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-label" id="settings-theme-label">
            {t('themeMode')}
          </label>
          <div className="settings-theme-options" role="group" aria-labelledby="settings-theme-label">
            <button
              type="button"
              className={`settings-theme-btn ${
                themePreference === 'system' ? 'active' : ''
              }`}
              aria-pressed={themePreference === 'system'}
              onClick={() => onThemeChange('system')}
            >
              {t('themeOptions.system')}
            </button>
            <button
              type="button"
              className={`settings-theme-btn ${
                themePreference === 'light' ? 'active' : ''
              }`}
              aria-pressed={themePreference === 'light'}
              onClick={() => onThemeChange('light')}
            >
              {t('themeOptions.light')}
            </button>
            <button
              type="button"
              className={`settings-theme-btn ${
                themePreference === 'dark' ? 'active' : ''
              }`}
              aria-pressed={themePreference === 'dark'}
              onClick={() => onThemeChange('dark')}
            >
              {t('themeOptions.dark')}
            </button>
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-label" htmlFor="settings-storage">
            {t('skillsStoragePath')}
          </label>
          <div className="settings-input-row">
            <input
              id="settings-storage"
              className="settings-input mono"
              value={storagePath}
              readOnly
            />
            <button
              className="btn btn-secondary settings-browse"
              type="button"
              onClick={onPickStoragePath}
            >
              {t('browse')}
            </button>
          </div>
          <div className="settings-helper">{t('skillsStorageHint')}</div>
        </div>

        <div className="settings-field">
          <label className="settings-label" htmlFor="settings-git-cache-days">
            {t('gitCacheCleanupDays')}
          </label>
          <div className="settings-input-row">
            <input
              id="settings-git-cache-days"
              className="settings-input"
              type="number"
              min={0}
              max={3650}
              step={1}
              value={gitCacheCleanupDays}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (!Number.isNaN(next)) {
                  onGitCacheCleanupDaysChange(next)
                }
              }}
            />
            <button
              className="btn btn-secondary settings-browse"
              type="button"
              onClick={onClearGitCacheNow}
            >
              {t('cleanNow')}
            </button>
          </div>
          <div className="settings-helper">{t('gitCacheCleanupHint')}</div>
        </div>

        <div className="settings-field">
          <label className="settings-label" htmlFor="settings-git-cache-ttl">
            {t('gitCacheTtlSecs')}
          </label>
          <div className="settings-input-row">
            <input
              id="settings-git-cache-ttl"
              className="settings-input"
              type="number"
              min={0}
              max={3600}
              step={1}
              value={gitCacheTtlSecs}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (!Number.isNaN(next)) {
                  onGitCacheTtlSecsChange(next)
                }
              }}
            />
          </div>
          <div className="settings-helper">{t('gitCacheTtlHint')}</div>
        </div>

        <div className="settings-field">
          <label className="settings-label" htmlFor="settings-github-token">
            {t('githubToken')}
          </label>
          <div className="settings-input-row">
            <input
              id="settings-github-token"
              className="settings-input mono"
              type="password"
              placeholder={t('githubTokenPlaceholder')}
              value={localToken}
              onChange={(e) => setLocalToken(e.target.value)}
              onBlur={() => {
                if (localToken !== githubToken) {
                  onGithubTokenChange(localToken)
                }
              }}
            />
          </div>
          <div className="settings-helper">{t('githubTokenHint')}</div>
        </div>

        <div className="settings-field">
          <label className="settings-label">{t('privateSource')}</label>
          <div className="settings-input-row">
            <input
              className="settings-input mono"
              placeholder={t('privateSourceFolderUrlPlaceholder')}
              value={psFolderUrl}
              onChange={(e) => { setPsFolderUrl(e.target.value); setPsTestMsg(null) }}
            />
          </div>
          <div className="settings-helper">{t('privateSourceFolderUrl')}</div>
          {psFolderUrl.trim() && (
            <div className={`settings-helper ${parsedCfg ? 'settings-update-ok' : 'settings-update-error'}`} style={{ marginTop: 2 }}>
              {parsedCfg
                ? t('privateSourceParsed', { url: parsedCfg.url, repo: parsedCfg.repo })
                : t('privateSourceParseError')}
            </div>
          )}
          <div className="settings-input-row" style={{ marginTop: 8 }}>
            <input
              className="settings-input mono"
              type="password"
              placeholder={t('privateSourceTokenPlaceholder')}
              value={psToken}
              onChange={(e) => setPsToken(e.target.value)}
            />
          </div>
          <div className="settings-helper">{t('privateSourceToken')}</div>
          <div className="settings-input-row" style={{ marginTop: 8, gap: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={psSaving || !parsedCfg}
              onClick={() => { void handleSavePrivateSource() }}
            >
              {t('privateSourceSave')}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              disabled={psTesting || !parsedCfg || !psToken.trim()}
              onClick={() => { void handleTestPrivateSource() }}
            >
              {t('privateSourceTest')}
            </button>
          </div>
          {psTestMsg && (
            <div className={`settings-helper ${psTestMsg.ok ? 'settings-update-ok' : 'settings-update-error'}`} style={{ marginTop: 4 }}>
              {psTestMsg.text}
            </div>
          )}
        </div>

        <div className="settings-field settings-update-section">
          <label className="settings-label">{t('appUpdates')}</label>
          <div className="settings-version-row">
            <span className="settings-version-text">
              {t('appName')} {versionText}
            </span>
            {isTauri && updateStatus === 'idle' && (
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={handleCheckUpdate}
              >
                {t('checkForUpdates')}
              </button>
            )}
            {updateStatus === 'checking' && (
              <span className="settings-update-status">{t('checkingUpdates')}</span>
            )}
            {updateStatus === 'up-to-date' && (
              <span className="settings-update-status settings-update-ok">{t('updateNotAvailable')}</span>
            )}
          </div>
          {updateStatus === 'available' && (
            <div className="settings-update-available">
              <span>{t('updateAvailableWithVersion', { version: updateVersion })}</span>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={handleInstallUpdate}
              >
                {t('downloadAndInstall')}
              </button>
            </div>
          )}
          {updateStatus === 'downloading' && (
            <div className="settings-update-status">{t('installingUpdate')}</div>
          )}
          {updateStatus === 'done' && (
            <div className="settings-update-ok">{t('updateInstalledRestart')}</div>
          )}
          {updateStatus === 'error' && (
            <div className="settings-update-error">
              <span>{updateError}</span>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={handleCheckUpdate}
              >
                {t('checkForUpdates')}
              </button>
            </div>
          )}
          <div className="settings-helper">{t('updateHint')}</div>
        </div>

      </div>
    </div>
  )
}

export default memo(SettingsPage)
