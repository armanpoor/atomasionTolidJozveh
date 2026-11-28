import React, { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Cloud,
  CloudUpload,
  HardDrive,
  Layers,
  LogOut,
  Search,
  ShieldCheck,
  Table2,
  Trophy,
  UserCircle2,
} from 'lucide-react';
import type { ApiClient } from '../../lib/apiClient';
import type { KnowledgeWishlistItem } from '../../lib/collaboration/platformTypes';
import { ContributeUploadPanel } from './ContributeUploadPanel';
import { ReferenceLibraryPanel } from './ReferenceLibraryPanel';
import { DriveBrowserPanel } from './DriveBrowserPanel';
import { SheetsReportPanel } from './SheetsReportPanel';
import { UnifiedSearchPanel } from './UnifiedSearchPanel';
import { CommunityLeaderboardWishlistPanel } from './CommunityLeaderboardWishlistPanel';
import { OwnerControlPanel } from './OwnerControlPanel';
import {
  WorkspaceConfirmModal,
  type WorkspaceConfirmRequest,
} from './WorkspaceConfirmModal';

export type CollabTabId =
  | 'contribute'
  | 'library'
  | 'drive'
  | 'sheets'
  | 'search'
  | 'community'
  | 'owner';

interface Props {
  apiClient: ApiClient;
  userDisplayName: string;
  userEmail: string | null;
  isGuest: boolean;
  workspaceAccessToken: string | null;
  onConnectWorkspace: () => Promise<string | null>;
  onSignOut: () => void;
  onSwitchToPersonalStudio: () => void;
  onOpenAdvancedAdminModal: () => void;
  onPersonalOutputFlagChange?: (enabled: boolean) => void;
}

type BootstrapData = Awaited<ReturnType<ApiClient['getCollabBootstrap']>>;

export const CollaborativeHubShell: React.FC<Props> = ({
  apiClient,
  userDisplayName,
  userEmail,
  isGuest,
  workspaceAccessToken,
  onConnectWorkspace,
  onSignOut,
  onSwitchToPersonalStudio,
  onOpenAdvancedAdminModal,
  onPersonalOutputFlagChange,
}) => {
  const [activeTab, setActiveTab] = useState<CollabTabId>('contribute');
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  // Navigation context
  const [selectedLibraryTarget, setSelectedLibraryTarget] = useState<{
    volumeId: string | null;
    chapterId: string | null;
  }>({ volumeId: null, chapterId: null });
  const [activeBounty, setActiveBounty] = useState<KnowledgeWishlistItem | null>(null);
  const [quickSearchInput, setQuickSearchInput] = useState('');
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState('');

  // Reusable Google Workspace confirmation modal
  const [confirmReq, setConfirmReq] = useState<WorkspaceConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const loadBootstrap = useCallback(async () => {
    try {
      const res = await apiClient.getCollabBootstrap();
      setBootstrap(res);
      onPersonalOutputFlagChange?.(res.enableUserPersonalOutput);
    } catch (err) {
      console.warn('[CollaborativeHub] Bootstrap load error:', err);
    }
  }, [apiClient, onPersonalOutputFlagChange]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap, refreshSignal]);

  // If Owner revokes access to the currently open tab, return gracefully to the Contribute tab
  useEffect(() => {
    if (!bootstrap) return;
    if (
      (activeTab === 'library' && !bootstrap.access.library) ||
      (activeTab === 'drive' && !bootstrap.access.drive) ||
      (activeTab === 'sheets' && !bootstrap.access.sheets) ||
      (activeTab === 'owner' && !bootstrap.isOwner)
    ) {
      setActiveTab('contribute');
    }
  }, [bootstrap, activeTab]);

  const triggerRefresh = useCallback(() => {
    setRefreshSignal((n) => n + 1);
  }, []);

  const handleConfirmProceed = async () => {
    if (!confirmReq) return;
    setConfirmBusy(true);
    try {
      await confirmReq.onConfirm();
    } finally {
      setConfirmBusy(false);
      setConfirmReq(null);
    }
  };

  const handleQuickSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (quickSearchInput.trim().length < 2) return;
    setSubmittedSearchQuery(quickSearchInput.trim());
    setActiveTab('search');
  };

  const navItems: Array<{
    id: CollabTabId;
    label: string;
    icon: React.ReactNode;
    visible: boolean;
  }> = [
    {
      id: 'contribute',
      label: 'مشارکت و آپلود',
      icon: <CloudUpload className="h-4 w-4" />,
      visible: true,
    },
    {
      id: 'library',
      label: 'کتابخانه مرجع و PDF / Docs',
      icon: <BookOpen className="h-4 w-4" />,
      visible: bootstrap ? bootstrap.access.library : true,
    },
    {
      id: 'drive',
      label: 'مرورگر Google Drive',
      icon: <HardDrive className="h-4 w-4" />,
      visible: bootstrap ? bootstrap.access.drive : true,
    },
    {
      id: 'sheets',
      label: 'گزارش Google Sheets',
      icon: <Table2 className="h-4 w-4" />,
      visible: bootstrap ? bootstrap.access.sheets : true,
    },
    {
      id: 'search',
      label: 'جستجوی سراسری',
      icon: <Search className="h-4 w-4" />,
      visible: true,
    },
    {
      id: 'community',
      label: 'امتیازات و نیازها',
      icon: <Trophy className="h-4 w-4" />,
      visible: true,
    },
    {
      id: 'owner',
      label: 'کنترل مالک',
      icon: <ShieldCheck className="h-4 w-4" />,
      visible: Boolean(bootstrap?.isOwner),
    },
  ];

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#1A1816]" dir="rtl">
      {/* Top Workspace Bar */}
      <header className="sticky top-0 z-30 border-b border-[#E2DDD3] bg-[#FCFBF8]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Brand Identity */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1E3A5F] text-white font-extrabold text-sm">
              خ
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-extrabold text-[#1A1816] sm:text-base">
                پلتفرم مشارکتی دیتابیس و کتاب‌های مرجع تخصصی خودرو
              </h1>
              <p className="text-[11px] text-[#6B645B] tabular-nums">
                {bootstrap
                  ? `${bootstrap.stats.volumesCount} جلد مرجع · ${bootstrap.stats.acceptedContributionsCount} مشارکت پذیرفته‌شده · ${bootstrap.stats.winolsAssetsCount} فایل WinOLS`
                  : 'تکمیل تیمی دانش فنی، WinOLS 2.24 و مراجع خودرو'}
              </p>
            </div>
          </div>

          {/* Unified Quick Search Bar */}
          <form
            onSubmit={handleQuickSearchSubmit}
            className="order-3 w-full sm:order-2 sm:w-auto sm:min-w-[280px] lg:min-w-[340px]"
          >
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-[#8C8375]" />
              <input
                type="text"
                value={quickSearchInput}
                onChange={(e) => setQuickSearchInput(e.target.value)}
                placeholder="جستجوی سریع ECU، کد خطا، خودرو یا .ols..."
                aria-label="جستجوی سریع در دیتابیس خودرو"
                className="w-full rounded-xl border border-[#D8D2C5] bg-white py-2 pl-3 pr-9 text-xs text-[#1A1816] focus:border-[#1E3A5F] focus:outline-none"
              />
            </div>
          </form>

          {/* Right Action Controls */}
          <div className="order-2 flex items-center gap-2 sm:order-3">
            <button
              type="button"
              onClick={() => void onConnectWorkspace()}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                workspaceAccessToken
                  ? 'border-[#C5DEC9] bg-[#EFF8F1] text-[#1F6B43]'
                  : 'border-[#D8D2C5] bg-white text-[#1A1816] hover:bg-[#F5F2EB]'
              }`}
            >
              <Cloud className="h-3.5 w-3.5" />
              {workspaceAccessToken ? 'Google Workspace متصل' : 'اتصال Google Workspace'}
            </button>

            {bootstrap?.enableUserPersonalOutput && (
              <button
                type="button"
                onClick={onSwitchToPersonalStudio}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#1E3A5F] px-3 py-2 text-xs font-semibold text-white hover:bg-[#162C49]"
              >
                <Layers className="h-3.5 w-3.5" />
                استودیو شخصی ۵ مرحله‌ای
              </button>
            )}

            <div className="hidden items-center gap-1.5 rounded-xl border border-[#EAE4D9] bg-white px-2.5 py-1.5 text-xs text-[#4A453F] md:flex">
              <UserCircle2 className="h-4 w-4 text-[#1E3A5F]" />
              <span className="max-w-[140px] truncate font-medium">
                {userDisplayName || userEmail || (isGuest ? 'کاربر مهمان' : 'کاربر')}
              </span>
            </div>

            <button
              type="button"
              onClick={onSignOut}
              className="rounded-xl border border-[#D8D2C5] bg-white p-2 text-[#5A544C] hover:bg-[#F5F2EB]"
              title="خروج از حساب"
              aria-label="خروج از حساب"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Navigation Strip */}
        <nav
          role="tablist"
          aria-label="ناوبری فضای کاری مشارکتی"
          className="mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-4 pb-2.5 sm:px-6"
        >
          {navItems
            .filter((item) => item.visible)
            .map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActiveTab(item.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                    isActive
                      ? 'bg-[#1E3A5F] text-white'
                      : 'text-[#4A453F] hover:bg-[#EFEAE0] hover:text-[#1A1816]'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
        </nav>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        {activeTab === 'contribute' && (
          <ContributeUploadPanel
            apiClient={apiClient}
            workspaceAccessToken={workspaceAccessToken}
            onConnectWorkspace={onConnectWorkspace}
            workspaceConfig={
              bootstrap?.workspaceConfig || {
                driveRootFolderId: null,
                driveRootFolderName: 'دیتابیس مرجع تخصصی خودرو',
                sheetsSpreadsheetId: null,
                sheetsSpreadsheetUrl: null,
                sheetsTabName: 'گزارش مشارکت‌ها',
              }
            }
            activeBounty={activeBounty}
            onClearBounty={() => setActiveBounty(null)}
            onContributionCompleted={triggerRefresh}
            onRequestWorkspaceConfirm={(req) => setConfirmReq(req)}
            onOpenLibraryVolume={(volumeId) => {
              setSelectedLibraryTarget({ volumeId, chapterId: null });
              setActiveTab('library');
            }}
            isOwner={Boolean(bootstrap?.isOwner)}
          />
        )}

        {activeTab === 'library' && (
          <ReferenceLibraryPanel
            apiClient={apiClient}
            initialVolumeId={selectedLibraryTarget.volumeId}
            initialChapterId={selectedLibraryTarget.chapterId}
            workspaceAccessToken={workspaceAccessToken}
            onConnectWorkspace={onConnectWorkspace}
            driveRootFolderId={bootstrap?.workspaceConfig.driveRootFolderId || null}
            onRequestWorkspaceConfirm={(req) => setConfirmReq(req)}
            refreshSignal={refreshSignal}
          />
        )}

        {activeTab === 'drive' && (
          <DriveBrowserPanel
            apiClient={apiClient}
            workspaceAccessToken={workspaceAccessToken}
            onConnectWorkspace={onConnectWorkspace}
            refreshSignal={refreshSignal}
          />
        )}

        {activeTab === 'sheets' && (
          <SheetsReportPanel
            apiClient={apiClient}
            workspaceAccessToken={workspaceAccessToken}
            onConnectWorkspace={onConnectWorkspace}
            driveRootFolderId={bootstrap?.workspaceConfig.driveRootFolderId || null}
            onRequestWorkspaceConfirm={(req) => setConfirmReq(req)}
            refreshSignal={refreshSignal}
          />
        )}

        {activeTab === 'search' && (
          <UnifiedSearchPanel
            apiClient={apiClient}
            initialQuery={submittedSearchQuery}
            workspaceAccessToken={workspaceAccessToken}
            driveRootFolderId={bootstrap?.workspaceConfig.driveRootFolderId || null}
            onConnectWorkspace={onConnectWorkspace}
            onOpenChapter={(volumeId, chapterId) => {
              setSelectedLibraryTarget({ volumeId, chapterId });
              setActiveTab('library');
            }}
          />
        )}

        {activeTab === 'community' && (
          <CommunityLeaderboardWishlistPanel
            apiClient={apiClient}
            isOwner={Boolean(bootstrap?.isOwner)}
            onFulfillBounty={(item) => {
              setActiveBounty(item);
              setActiveTab('contribute');
            }}
            refreshSignal={refreshSignal}
          />
        )}

        {activeTab === 'owner' && bootstrap?.isOwner && (
          <OwnerControlPanel
            apiClient={apiClient}
            workspaceAccessToken={workspaceAccessToken}
            onConnectWorkspace={onConnectWorkspace}
            onSettingsUpdated={triggerRefresh}
            onOpenAdvancedAdminModal={onOpenAdvancedAdminModal}
            onRequestWorkspaceConfirm={(req) => setConfirmReq(req)}
          />
        )}
      </main>

      {/* Google Workspace Explicit Confirmation Modal */}
      <WorkspaceConfirmModal
        request={confirmReq}
        busy={confirmBusy}
        onCancel={() => setConfirmReq(null)}
        onProceed={() => void handleConfirmProceed()}
      />
    </div>
  );
};
