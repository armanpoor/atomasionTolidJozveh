import React, { useEffect, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Loader2,
  Plus,
  Target,
  Trash2,
  Trophy,
} from 'lucide-react';
import type { ApiClient } from '../../lib/apiClient';
import type {
  KnowledgeWishlistItem,
  LeaderboardEntry,
} from '../../lib/collaboration/platformTypes';

interface Props {
  apiClient: ApiClient;
  isOwner: boolean;
  onFulfillBounty: (item: KnowledgeWishlistItem) => void;
  refreshSignal: number;
}

export const CommunityLeaderboardWishlistPanel: React.FC<Props> = ({
  apiClient,
  isOwner,
  onFulfillBounty,
  refreshSignal,
}) => {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [totalScoreDistributed, setTotalScoreDistributed] = useState(0);
  const [wishlist, setWishlist] = useState<KnowledgeWishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New Wishlist Form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDomain, setNewDomain] = useState('remap_tuning');
  const [newVehicle, setNewVehicle] = useState('');
  const [newEcu, setNewEcu] = useState('');
  const [newFormat, setNewFormat] = useState('kp');
  const [newBonus, setNewBonus] = useState(70);
  const [savingWish, setSavingWish] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [lbRes, wlRes] = await Promise.all([
        apiClient.getCollabLeaderboard(),
        apiClient.getCollabWishlist(),
      ]);
      setLeaderboard(lbRes.leaderboard);
      setTotalScoreDistributed(lbRes.totalScoreDistributed);
      setWishlist(wlRes.items);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در دریافت جدول امتیازات و نیازها.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const handleAddWishlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newTitle.trim().length < 4) return;
    setSavingWish(true);
    try {
      const res = await apiClient.createCollabWishlistItem({
        title: newTitle.trim(),
        description: newDesc.trim(),
        domainId: newDomain,
        vehicleModel: newVehicle.trim() || undefined,
        ecuModel: newEcu.trim() || undefined,
        wantedFormat: newFormat,
        bonusScore: newBonus,
      });
      setWishlist((prev) => [res.item, ...prev]);
      setNewTitle('');
      setNewDesc('');
      setNewVehicle('');
      setNewEcu('');
      setShowAddForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در ثبت نیاز جدید.');
    } finally {
      setSavingWish(false);
    }
  };

  const handleDeleteWishlist = async (id: string) => {
    try {
      await apiClient.deleteCollabWishlistItem(id);
      setWishlist((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'خطا در حذف مورد.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-[#E2DDD3] bg-white p-12 text-sm text-[#5A544C]">
        <Loader2 className="ml-2 h-5 w-5 animate-spin text-[#1E3A5F]" />
        در حال بارگذاری جدول امتیازات تیم و لیست نیازهای دیتابیس...
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {errorMsg && (
        <div className="rounded-xl border border-[#E6B8B8] bg-[#FDF2F2] p-4 text-xs text-[#8C2D2D]">
          {errorMsg}
        </div>
      )}

      {/* 1. Knowledge Wishlist / Bounties */}
      <section className="rounded-2xl border border-[#E2DDD3] bg-white p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#EFEAE0] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FDF4E2] text-[#9B6F12]">
              <Target className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1A1816]">
                لیست نیازهای دیتابیس و پاداش مشارکت (Knowledge Wishlist)
              </h2>
              <p className="text-xs text-[#6B645B]">
                مدل‌های ECU، فایل‌های .ols / .kp و سرفصل‌هایی که تکمیل آن‌ها امتیاز تشویقی ویژه دارد
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#1E3A5F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#162C49]"
          >
            <Plus className="h-3.5 w-3.5" />
            {showAddForm ? 'بستن فرم' : 'ثبت نیاز جدید'}
          </button>
        </div>

        {showAddForm && (
          <form
            onSubmit={handleAddWishlist}
            className="mb-5 grid grid-cols-1 gap-3 rounded-xl border border-[#DFD7C8] bg-[#FAF9F6] p-4 md:grid-cols-2"
          >
            <div className="md:col-span-2">
              <label
                htmlFor="wishlist-title"
                className="mb-1 block text-xs font-semibold text-[#3E3934]"
              >
                عنوان نیاز دیتابیس
              </label>
              <input
                id="wishlist-title"
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="مثلاً: فایل .kp کامل برای Bosch MED17.4.4 پژو ۲۰۰۸"
                className="w-full rounded-xl border border-[#D8D2C5] bg-white px-3 py-2 text-xs text-[#1A1816]"
              />
            </div>

            <div>
              <label
                htmlFor="wishlist-vehicle"
                className="mb-1 block text-xs font-semibold text-[#3E3934]"
              >
                مدل خودرو
              </label>
              <input
                id="wishlist-vehicle"
                type="text"
                value={newVehicle}
                onChange={(e) => setNewVehicle(e.target.value)}
                placeholder="مثلاً: Peugeot 2008 / دنا پلاس"
                className="w-full rounded-xl border border-[#D8D2C5] bg-white px-3 py-2 text-xs text-[#1A1816]"
              />
            </div>

            <div>
              <label
                htmlFor="wishlist-ecu"
                className="mb-1 block text-xs font-semibold text-[#3E3934]"
              >
                مدل ECU
              </label>
              <input
                id="wishlist-ecu"
                type="text"
                value={newEcu}
                onChange={(e) => setNewEcu(e.target.value)}
                placeholder="مثلاً: Bosch MED17.4.4"
                className="w-full rounded-xl border border-[#D8D2C5] bg-white px-3 py-2 text-xs text-[#1A1816]"
              />
            </div>

            <div>
              <label
                htmlFor="wishlist-domain"
                className="mb-1 block text-xs font-semibold text-[#3E3934]"
              >
                حوزه مرجع
              </label>
              <select
                id="wishlist-domain"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                className="w-full rounded-xl border border-[#D8D2C5] bg-white px-3 py-2 text-xs text-[#1A1816]"
              >
                <option value="remap_tuning">ریمپ پیشرفته و WinOLS (جلد ۵)</option>
                <option value="ecu_cybersecurity">ساختار سخت‌افزاری ECU (جلد ۴)</option>
                <option value="electrical_networks">برق و مالتی‌پلکس (جلد ۲)</option>
                <option value="diagnostics_obd">دیاگ و DTC (جلد ۳)</option>
                <option value="engine_mechanics">مکانیک و تنظیم موتور (جلد ۱)</option>
                <option value="hybrid_ev">گیربکس و هیبرید/برقی (جلد ۶)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="wishlist-format"
                  className="mb-1 block text-xs font-semibold text-[#3E3934]"
                >
                  فرمت مطلوب
                </label>
                <select
                  id="wishlist-format"
                  value={newFormat}
                  onChange={(e) => setNewFormat(e.target.value)}
                  className="w-full rounded-xl border border-[#D8D2C5] bg-white px-3 py-2 text-xs text-[#1A1816]"
                >
                  <option value="ols">.ols</option>
                  <option value="kp">.kp</option>
                  <option value="pdf">PDF</option>
                  <option value="audio">صوتی</option>
                  <option value="any">هر فرمتی</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="wishlist-bonus"
                  className="mb-1 block text-xs font-semibold text-[#3E3934]"
                >
                  امتیاز پاداش
                </label>
                <input
                  id="wishlist-bonus"
                  type="number"
                  min={10}
                  max={200}
                  value={newBonus}
                  onChange={(e) => setNewBonus(Number(e.target.value) || 60)}
                  className="w-full rounded-xl border border-[#D8D2C5] bg-white px-3 py-2 text-xs text-[#1A1816] tabular-nums"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="wishlist-description"
                className="mb-1 block text-xs font-semibold text-[#3E3934]"
              >
                توضیحات
              </label>
              <textarea
                id="wishlist-description"
                rows={2}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="جزییات جداول یا سرفصل‌های مورد نیاز..."
                className="w-full rounded-xl border border-[#D8D2C5] bg-white p-2.5 text-xs text-[#1A1816]"
              />
            </div>

            <div className="flex justify-end md:col-span-2">
              <button
                type="submit"
                disabled={savingWish}
                className="rounded-xl bg-[#1E3A5F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#162C49] disabled:opacity-60"
              >
                {savingWish ? 'در حال ثبت...' : 'ذخیره در لیست نیازها'}
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {wishlist.map((item) => {
            const isOpen = item.status === 'open';
            return (
              <div
                key={item.id}
                className={`flex flex-col justify-between rounded-xl border p-4 ${
                  isOpen
                    ? 'border-[#E2DDD3] bg-[#FCFBF8]'
                    : 'border-[#CFE3D6] bg-[#F4FAF6]'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-[#1A1816]">{item.title}</h3>
                    <span
                      className="shrink-0 text-xs font-extrabold text-[#9B6F12] tabular-nums"
                      dir="ltr"
                    >
                      +{item.bonusScore}
                    </span>
                  </div>
                  <p className="text-xs leading-6 text-[#5A544C]">{item.description}</p>
                  <p className="text-[11px] text-[#6B645B]">
                    {[
                      item.vehicleModel ? `خودرو: ${item.vehicleModel}` : '',
                      item.ecuModel ? `ECU: ${item.ecuModel}` : '',
                      `فرمت: ${item.wantedFormat.toUpperCase()}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#EFEAE0] pt-3">
                  {isOpen ? (
                    <button
                      type="button"
                      onClick={() => onFulfillBounty(item)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#162C49]"
                    >
                      <Award className="h-3.5 w-3.5" />
                      مشارکت برای این نیاز
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1F6B43]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      تکمیل شد ({item.fulfilledByEmail})
                    </span>
                  )}

                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteWishlist(item.id)}
                      className="rounded-lg p-1.5 text-[#8C2D2D] hover:bg-[#FCECEC]"
                      aria-label="حذف نیاز"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. Team Leaderboard & Specialty Badges */}
      <section className="rounded-2xl border border-[#E2DDD3] bg-white p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#EFEAE0] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1E3A5F]/10 text-[#1E3A5F]">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1A1816]">
                جدول امتیازات تیم و نشان‌های تخصصی (Leaderboard)
              </h2>
              <p className="text-xs text-[#6B645B] tabular-nums">
                مجموع امتیاز توزیع‌شده در تیم: {totalScoreDistributed.toLocaleString('fa-IR')} امتیاز
              </p>
            </div>
          </div>
        </div>

        {leaderboard.length === 0 ? (
          <p className="py-6 text-center text-sm text-[#6B645B]">
            هنوز امتیازی در جدول ثبت نشده است. با اولین مشارکت علمی، نام شما در صدر جدول ثبت می‌شود.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-[#EAE4D9] bg-[#FAF9F6] text-[#5A544C]">
                <tr>
                  <th className="px-4 py-3 font-semibold">رتبه</th>
                  <th className="px-4 py-3 font-semibold">عضو تیم</th>
                  <th className="px-4 py-3 font-semibold">نشان تخصصی</th>
                  <th className="px-4 py-3 font-semibold">تعداد ارسال</th>
                  <th className="px-4 py-3 font-semibold">فایل WinOLS</th>
                  <th className="px-4 py-3 font-semibold">میانگین محتوای جدید</th>
                  <th className="px-4 py-3 font-semibold">مجموع امتیاز</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1ECE1]">
                {leaderboard.map((row) => (
                  <tr key={row.uploaderKey} className="hover:bg-[#FCFBF8]">
                    <td className="px-4 py-3 font-extrabold text-[#1E3A5F] tabular-nums">
                      #{row.rank}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-[#1A1816]">{row.displayName}</p>
                      <p className="text-[11px] text-[#6B645B]">
                        {row.uploaderType === 'email' ? row.email : 'کاربر مهمان'}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-semibold text-[#1E3A5F]">
                      {row.specialtyBadgeFa}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {row.acceptedCount} از {row.contributionsCount}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{row.winolsCount}</td>
                    <td className="px-4 py-3 font-semibold text-[#1F6B43] tabular-nums">
                      {row.avgNewPercent}%
                    </td>
                    <td className="px-4 py-3 text-sm font-extrabold text-[#1E3A5F] tabular-nums">
                      {row.totalScore.toLocaleString('fa-IR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
